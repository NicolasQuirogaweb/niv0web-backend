const mongoose = require('mongoose');

const prodMixMastersSchema = new mongoose.Schema({
    title: {
        type: String,
        required: [true, "El título del sample es obligatorio"],
        maxlength: [100, "El título no puede exceder los 100 caracteres"],
    },
    description: {
        type: String,
        required: [true, "La descripción es obligatoria"],
        maxlength: [300, "La descripción no puede exceder los 300 caracteres"],
    },
    audioFile: {
        type: String,
        required: [true, "La ruta del archivo de audio es obligatoria"],
        validate: {
            validator: function (url) {
                return /^(https?:\/\/|\/)/.test(url);
            },
            message: "La ruta del archivo de audio no es válida",
        },
    },
}, { timestamps: true });

prodMixMastersSchema.index({ createdAt: -1 });

// Se mantiene el nombre de la colección en plural "prodmixmasters"
const ProdMixMasters = mongoose.model('ProdMixMasters', prodMixMastersSchema, 'prodmixmasters');

module.exports = ProdMixMasters;
