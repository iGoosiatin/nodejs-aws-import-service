import 'dotenv/config';
import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigatewayv2_integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';

if (
  !(
    process.env.AWS_BUCKET_NAME &&
    process.env.UPLOAD_DIR &&
    process.env.PRODUCTS_TABLE &&
    process.env.STOCKS_TABLE &&
    process.env.PARSED_DIR
  )
) {
  throw new Error(
    'No AWS_BUCKET_NAME, PRODUCTS_TABLE, STOCKS_TABLE, UPLOAD_DIR or PARSED_DIR environment variable found',
  );
}

const environment = {
  AWS_BUCKET_NAME: process.env.AWS_BUCKET_NAME,
  UPLOAD_DIR: process.env.UPLOAD_DIR,
  PARSED_DIR: process.env.PARSED_DIR,
  PRODUCTS_TABLE: process.env.PRODUCTS_TABLE,
  STOCKS_TABLE: process.env.STOCKS_TABLE,
};

export class ImportProductsStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Import existing bucket
    const bucket = s3.Bucket.fromBucketAttributes(this, 'ImportS3Bucket', {
      bucketName: environment.AWS_BUCKET_NAME,
    });

    // Reference DynamoDB tables
    const productsTable = dynamodb.Table.fromTableName(this, 'ProductsTable', environment.PRODUCTS_TABLE);
    const stocksTable = dynamodb.Table.fromTableName(this, 'StocksTable', environment.STOCKS_TABLE);

    // Create import lambda Function
    const importFunction = new lambda.Function(this, 'ImportProductsFileFunction', {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'lib/importProductsFile.handler',
      code: lambda.Code.fromAsset('build'),
      environment,
    });

    // Create file parser lambda function
    const parserFunction = new lambda.Function(this, 'ProductsParserFunction', {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'lib/importFileParser.handler',
      code: lambda.Code.fromAsset('build', {
        bundling: {
          image: lambda.Runtime.NODEJS_22_X.bundlingImage,
          command: [
            'bash',
            '-c',
            ['cp -r . /tmp', 'cd /tmp', 'npm install csv-parse', 'cp -r . /asset-output/'].join(' && '),
          ],
          user: 'root',
        },
      }),
      environment,
    });

    // Grant Lambda permissions to access S3
    bucket.grantReadWrite(importFunction);

    // Grant Lambda permissions to put data to DB
    productsTable.grantWriteData(parserFunction);
    stocksTable.grantWriteData(parserFunction);

    // Grant permissions to read from uploaded folder
    const s3ParserPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject', 's3:ListBucket'],
      resources: [
        // Permission for the bucket itself (for ListBucket)
        bucket.bucketArn,
        // Permissions for objects in both directories
        `${bucket.bucketArn}/${environment.UPLOAD_DIR}/*`,
        `${bucket.bucketArn}/${environment.PARSED_DIR}/*`,
      ],
    });

    parserFunction.addToRolePolicy(s3ParserPolicy);

    // Add S3 notification for uploaded files
    bucket.addEventNotification(s3.EventType.OBJECT_CREATED, new s3n.LambdaDestination(parserFunction), {
      prefix: `${environment.UPLOAD_DIR}/`,
    });

    // Create HTTP API
    const httpApi = new apigatewayv2.HttpApi(this, 'ImportApi', {
      corsPreflight: {
        allowMethods: [apigatewayv2.CorsHttpMethod.GET],
        allowOrigins: ['*'],
        allowHeaders: ['Content-Type', 'X-Amz-Date', 'Authorization', 'X-Api-Key', 'X-Amz-Security-Token'],
      },
    });

    // Create Lambda integration
    const lambdaIntegration = new apigatewayv2_integrations.HttpLambdaIntegration('ImportIntegration', importFunction);

    // Add route
    httpApi.addRoutes({
      path: '/import',
      methods: [apigatewayv2.HttpMethod.GET],
      integration: lambdaIntegration,
    });

    // Output the API URL
    new cdk.CfnOutput(this, 'ImportApiUrl', {
      value: httpApi.url ?? '',
      description: 'HTTP API endpoint URL',
    });
  }
}
