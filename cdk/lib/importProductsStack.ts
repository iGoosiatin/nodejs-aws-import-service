import 'dotenv/config';
import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigatewayv2_integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';

if (!process.env.AWS_BUCKET_NAME) {
  throw new Error('No AWS_BUCKET_NAME environment variable found');
}
const AWS_BUCKET_NAME = process.env.AWS_BUCKET_NAME;

export class ImportProductsStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Import existing bucket
    const bucket = s3.Bucket.fromBucketAttributes(this, 'ImportS3Bucket', {
      bucketName: AWS_BUCKET_NAME,
    });

    // Create Lambda Function
    const importFunction = new lambda.Function(this, 'ImportProductsFileFunction', {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'lib/importProductsFile.handler',
      code: lambda.Code.fromAsset('build'),
      environment: {
        AWS_BUCKET_NAME,
      },
    });

    // Grant Lambda permissions to access S3
    bucket.grantReadWrite(importFunction);

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
