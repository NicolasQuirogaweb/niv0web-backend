const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const User = require('../models/User');

passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: "http://localhost:3000", // URL de redirección después de la autenticación
  },
  async (token, tokenSecret, profile, done) => {
    try {
      const existingUser = await User.findOne({ googleId: profile.id });
      
      if (existingUser) {
        return done(null, existingUser); // Si el usuario ya existe, devuelve el usuario
      }

      // Si el usuario no existe, creamos uno nuevo
      const newUser = new User({
        googleId: profile.id,
        email: profile.emails[0].value, // Su correo electrónico
        name: profile.displayName,
      });

      await newUser.save();
      done(null, newUser);
    } catch (err) {
      done(err, null);
    }
  }
));

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (err) {
    done(err, null);
  }
});
