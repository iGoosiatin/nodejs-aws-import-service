import { S3Event } from 'aws-lambda';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import crypto from 'crypto';
import { parse } from 'csv-parse';
import { Readable } from 'stream';
import { Product } from 'types';

const productsTable = process.env.PRODUCTS_TABLE;
const stocksTable = process.env.STOCKS_TABLE;

if (!(productsTable && stocksTable)) {
  throw new Error('No PRODUCTS_TABLE and STOCKS_TABLE environment variable found');
}

const s3Client = new S3Client({});
const client = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(client);

const createProduct = async (product: Product): Promise<{ id: string } & Product> => {
  const id = crypto.randomUUID();
  const { title, description, price, count } = product;

  const transactionCommand = new TransactWriteCommand({
    TransactItems: [
      {
        Put: {
          TableName: productsTable,
          Item: {
            id,
            title,
            description,
            price,
          },
        },
      },
      {
        Put: {
          TableName: stocksTable,
          Item: {
            id,
            count,
          },
        },
      },
    ],
  });

  await docClient.send(transactionCommand);

  return {
    id,
    ...product,
  };
};

const getValidProduct = (product: unknown): Product => {
  if (typeof product !== 'object' || !product) {
    throw new Error('Invalid product format');
  }

  ['title', 'description', 'price', 'count'].forEach(field => {
    if (!(field in product)) {
      throw new Error(`Invalid product data: ${field} is missing!`);
    }
  });

  if (!('title' in product && 'description' in product && 'price' in product && 'count' in product)) {
    // This part of code is just to please TS
    throw new Error();
  }

  const { title, description } = product;
  let { price, count } = product;
  price = Number(price);
  count = Number(count);

  if (!title) {
    throw new Error('Invalid product data: title should not be empty!');
  }
  if (!description) {
    throw new Error('Invalid product data: description should not be empty!');
  }
  if (typeof price !== 'number' || isNaN(price)) {
    throw new Error('Invalid product data: price should be a number!');
  }
  if (price <= 0) {
    throw new Error('Invalid product data: price should be greater than 0!');
  }
  if (typeof count !== 'number' || isNaN(count)) {
    throw new Error('Invalid product data: count should be a number!');
  }
  if (count < 0) {
    throw new Error('Invalid product data: count should not be less than 0!');
  }

  return product as Product;
};

const handleProduct = async (product: unknown): Promise<void> => {
  console.log('Product to process:', product);
  let validProduct: Product;
  try {
    validProduct = getValidProduct(product);
    console.log('Valid product to be saved:', validProduct);
  } catch (error) {
    console.error('Error processing product:', (error as Error).message);
    return;
  }

  const savedProduct = await createProduct(validProduct);
  console.log('Saved product:', savedProduct);
};

const handleFile = async (Bucket: string, Key: string): Promise<void> => {
  const getCommand = new GetObjectCommand({ Bucket, Key });
  const response = await s3Client.send(getCommand);
  const stream = response.Body as Readable;

  return new Promise((resolve, reject) => {
    const promises: Promise<void>[] = [];

    stream.pipe(
      parse({
        columns: true,
        skip_empty_lines: true,
      }).on('data', record => {
        promises.push(handleProduct(record));
      }),
    );

    stream.on('error', reject);
    stream.on('end', async () => {
      await Promise.all(promises);
      resolve();
    });
  });
};

export const handler = async ({ Records }: S3Event) => {
  try {
    await Promise.all(
      Records.map(async ({ s3 }) => {
        await handleFile(s3.bucket.name, s3.object.key);
      }),
    );
  } catch (error) {
    console.error('Error processing CSV:', error);
    throw error;
  }
};
