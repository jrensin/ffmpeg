const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const fs = require('fs');
const path = require('path');

let s3Client = null;

function getClient() {
  if (!s3Client) {
    s3Client = new S3Client({
      endpoint: process.env.B2_ENDPOINT,
      region: 'us-west-000',
      credentials: {
        accessKeyId: process.env.B2_KEY_ID,
        secretAccessKey: process.env.B2_APP_KEY,
      },
      forcePathStyle: true,
    });
  }
  return s3Client;
}

async function uploadToB2(localPath, b2Key) {
  const client = getClient();
  const fileStream = fs.createReadStream(localPath);
  const ext = path.extname(localPath).toLowerCase();

  const contentTypes = {
    '.mp4': 'video/mp4',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.srt': 'text/plain',
    '.vtt': 'text/vtt',
    '.txt': 'text/plain',
  };

  const command = new PutObjectCommand({
    Bucket: process.env.B2_BUCKET,
    Key: b2Key,
    Body: fileStream,
    ContentType: contentTypes[ext] || 'application/octet-stream',
  });

  await client.send(command);

  return `${process.env.B2_PUBLIC_URL}/${b2Key}`;
}

module.exports = { uploadToB2 };
