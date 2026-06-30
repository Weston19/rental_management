const multer = require('multer');
const path = require('path');

// Use memory storage since Vercel doesn't have persistent disk
const storage = multer.memoryStorage();

// File filter for images only
const fileFilter = (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
        cb(null, true);  // ✅ Accept file
    } else {
        cb(new Error('Only image files are allowed (jpeg, jpg, png, gif, webp)'));  // ❌ Reject file
    }
};

// Configure multer
const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    fileFilter: fileFilter
});

module.exports = upload;