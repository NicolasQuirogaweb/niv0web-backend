const B2 = require('backblaze-b2');
const path = require('path');

const b2 = new B2({
  applicationKeyId: process.env.B2_KEY_ID,
  applicationKey: process.env.B2_APPLICATION_KEY,
});

let authorized = false;

const ensureAuth = async () => {
  if (!authorized) {
    await b2.authorize();
    authorized = true;
  }
};

const uploadToB2 = async (fileBuffer, fileName, folder = 'uploads') => {
  await ensureAuth();

  const cleanName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const uniqueName = `${Date.now()}-${cleanName}`;
  const key = `${folder}/${uniqueName}`;

  const { data: uploadUrl } = await b2.getUploadUrl({
    bucketId: process.env.B2_BUCKET_ID,
  });

  const response = await b2.uploadFile({
    uploadUrl: uploadUrl.uploadUrl,
    uploadAuthToken: uploadUrl.authorizationToken,
    fileName: key,
    data: fileBuffer,
  });

  const publicUrl = `${process.env.B2_PUBLIC_URL}/${process.env.B2_BUCKET_NAME}/${key}`;
  return publicUrl;
};

module.exports = { uploadToB2 };
