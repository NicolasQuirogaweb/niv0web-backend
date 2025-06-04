const mongoose = require('mongoose');

const samplePackSchema = new mongoose.Schema({
    title: {
        type: String,
        required: true,  // Título del sample pack
    },
    description: {
        type: String,
        required: true,  // Descripción del sample pack
    },
    imageUrl: {
        type: String,
        required: true,  // URL de la imagen del sample pack
    },
    
    createdAt: {
        type: Date,
        default: Date.now,  // Fecha de creación
    },
    // Relación con los samples (referencia a los samples asociados a este samplepack)
        samples: [{
            type: mongoose.Schema.Types.ObjectId,
            ref: 'sample',  // Referencia al modelo Beat
        }],
    type: {  // Agregar este campo para diferenciar entre 'beats' y 'sample_pack'
        type: String,
        enum: [ 'samples'],
        required: true,  // Tipo de playlist
    },
});  // Aquí especificamos el nombre correcto de la colección

const SamplePack = mongoose.model('SamplePack', samplePackSchema);

module.exports = SamplePack;
