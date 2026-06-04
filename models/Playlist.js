const mongoose = require('mongoose');

const playlistSchema = new mongoose.Schema({
    title: {
        type: String,
        required: true,
    },
    description: {
        type: String,
        required: true,
    },
    imageUrl: {
        type: String,
        required: true,
    },
    backgroundVideo: {
        type: String,
        required: true,
    },
    createdAt: {
        type: Date,
        default: Date.now,
    },
    type: {
        type: String,
        enum: ['beats', 'loops'],
        required: true,
    },
}, { timestamps: true });

playlistSchema.index({ createdAt: -1 });

const Playlist = mongoose.model('Playlist', playlistSchema);

module.exports = Playlist;
