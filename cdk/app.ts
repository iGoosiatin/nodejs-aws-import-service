import * as cdk from 'aws-cdk-lib';
import { ImportProductsStack } from './lib/importProductsStack';

const app = new cdk.App();
new ImportProductsStack(app, 'ImportProductsStack');
app.synth();
