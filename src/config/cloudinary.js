const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

/**
 * Sube un Buffer a Cloudinary y devuelve el resultado.
 * @param {Buffer} buffer
 * @param {import('cloudinary').UploadApiOptions} options
 * @returns {Promise<import('cloudinary').UploadApiResponse>}
 */
function uploadToCloudinary(buffer, options = {}) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(options, (err, result) => {
      if (err) return reject(err);
      resolve(result);
    });
    stream.end(buffer);
  });
}

module.exports = { cloudinary, uploadToCloudinary };
