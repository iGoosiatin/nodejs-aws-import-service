import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import crypto from 'crypto';
import { headers } from './helpers';

const BUCKET = process.env.AWS_BUCKET_NAME;
const UPLOAD_DIR = process.env.UPLOAD_DIR;

if (!(process.env.AWS_BUCKET_NAME && process.env.UPLOAD_DIR)) {
  throw new Error('No AWS_BUCKET_NAME or UPLOAD_DIR environment variable found');
}

const s3Client = new S3Client({});

const generateSignedUrl = async (fileName: string): Promise<string> => {
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: `${UPLOAD_DIR}/${fileName.replace('.csv', `-${crypto.randomUUID()}.csv`)}`,
    ContentType: 'text/csv',
  });

  const signedUrl = await getSignedUrl(s3Client, command, {
    expiresIn: 3600,
  });

  return signedUrl;
};

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const fileName = event.queryStringParameters?.name;

    if (!fileName || !fileName.toLowerCase().endsWith('.csv')) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          message: 'Invalid file name. Please provide a CSV file.',
        }),
      };
    }

    const signedUrl = await generateSignedUrl(fileName);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(signedUrl),
    };
  } catch {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        message: 'Internal server error',
      }),
    };
  }
};
