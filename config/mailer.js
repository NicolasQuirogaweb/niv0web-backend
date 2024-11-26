const nodemailer = require('nodemailer');

// Configuración de transporte de Nodemailer
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER, // Asegúrate de agregar tu correo electrónico en el archivo .env
    pass: process.env.EMAIL_PASS, // Asegúrate de agregar tu contraseña en el archivo .env
  },
});

// Función para enviar el correo de bienvenida
const sendWelcomeEmail = (email) => {
  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: email,
    subject: 'THANKS AND ENJOY!',
    text: '¡Gracias por registrarte! Disfruta de la experiencia en nuestra página.',
  };

  return transporter.sendMail(mailOptions)
    .then(() => console.log('Correo de bienvenida enviado'))
    .catch(error => console.error('Error al enviar el correo:', error));
};

module.exports = { sendWelcomeEmail };
