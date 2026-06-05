const B2 = require('backblaze-b2');
const path = require('path');

const b2 = new B2({
  applicationKeyId: process.env.B2_KEY_ID,
  applicationKey: process.env.B2_APPLICATION_KEY,
});

let authPromise = null;
let authAttempts = 0;

const getAuth = async () => {
  if (!authPromise) {
    authAttempts++;
    authPromise = b2.authorize().then(res => {
      authAttempts = 0;
      return res;
    }).catch(err => {
      authPromise = null;
      throw err;
    });
  }
  return authPromise;
};

const uploadFileToB2 = async (fileBuffer, fileName, folder) => {
  const cleanName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const uniqueName = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}-${cleanName}`;
  const key = `${folder}/${uniqueName}`;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await getAuth();
      const { data: uploadUrl } = await b2.getUploadUrl({ bucketId: process.env.B2_BUCKET_ID });

      await b2.uploadFile({
        uploadUrl: uploadUrl.uploadUrl,
        uploadAuthToken: uploadUrl.authorizationToken,
        fileName: key,
        data: fileBuffer,
      });

      return `${process.env.B2_PUBLIC_URL}/${process.env.B2_BUCKET_NAME}/${key}`;
    } catch (err) {
      const status = err.response?.status;
      const isAuthError = status === 401 || status === 403 || err.code === 'ERR_RATE_LIMIT';
      if (isAuthError) {
        authPromise = null;
        continue;
      }
      if (status === 429 || status >= 500 || err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT') {
        if (attempt < 2) continue;
      }
      err.uploadContext = { fileName, key, attempt };
      throw err;
    }
  }
};

const uploadToB2 = async (fileBuffer, fileName, folder = 'uploads') => {
  return uploadFileToB2(fileBuffer, fileName, folder);
};

module.exports = { uploadToB2 };
