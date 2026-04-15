const router = require('express').Router();
const { searchUsers, getUserByUsername, updateProfile, changePassword } = require('../controllers/users.controller');
const { authenticate }  = require('../middleware/auth');
const { uploadImage }   = require('../config/multer');

// All routes require authentication
router.use(authenticate);

router.get   ('/search',          searchUsers);
router.get   ('/:username',       getUserByUsername);
router.patch ('/me', (req, res, next) => {
  uploadImage.single('avatar')(req, res, (err) => {
    if (err) return next(err);
    updateProfile(req, res, next);
  });
});
router.post  ('/change-password', changePassword);

module.exports = router;
