
const express = require('express');
const session = require('express-session');
const msal = require('@azure/msal-node');
const axios = require('axios');
const authConfig = require('./authConfig');
const ejsMate = require('ejs-mate');

const app = express();
const port = process.env.PORT || 3000;

// Set EJS as the template engine
app.engine('ejs', ejsMate);
app.set('view engine', 'ejs');

// Serve static files from the public directory
app.use(express.static('public'));

// Set up session middleware
app.use(session({
  secret: 'your_secret_key', // Replace with a strong secret key
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: process.env.NODE_ENV === 'production', // Set to true if using HTTPS
    httpOnly: true, // Prevent client-side JavaScript from accessing the cookie
    maxAge: 3600000 // Set session expiration to 1 hour (in milliseconds)
  } 
}));


const cca = new msal.ConfidentialClientApplication(authConfig);

// Middleware to check if user is logged in or if the session is not dead
function checkSession(req, res, next) {
  if (!req.session || !req.session.accessToken) {
    // Destroy the session and clear the session cookie
    req.session.destroy((err) => {
      if (err) {
        console.log('Error destroying session:', err);
        res.status(500).send('Error ending session');
      } else {
        res.clearCookie('connect.sid'); // Clear the session cookie
        res.redirect('/login');
      }
    });
  } else {
    next();
  }
}

app.get('/', (req, res) => {
  if (req.session.accessToken) {
    res.redirect('/dashboard');
  } else {
    res.redirect('/login');
  }
});

app.get('/login', async (req, res) => {
  const authCodeUrlParameters = {
    scopes: ["User.Read"],
    redirectUri: process.env.REDIRECT_URI,
  };

  try {
    const response = await cca.getAuthCodeUrl(authCodeUrlParameters);
    res.redirect(response);
  } catch (error) {
    console.log(error);
    res.status(500).send('Error getting auth code URL');
  }
});

app.get('/redirect', async (req, res) => {
  const tokenRequest = {
    code: req.query.code,
    scopes: ["User.Read"],
    redirectUri: process.env.REDIRECT_URI,
  };

  try {
    const response = await cca.acquireTokenByCode(tokenRequest);
 
    req.session.accessToken = response.accessToken;

    // Fetch user information
    const userInfo = await axios.get('https://graph.microsoft.com/v1.0/me', {
      headers: {
        Authorization: `Bearer ${req.session.accessToken}`,
      },
    });

    const userPhoto = await axios.get('https://graph.microsoft.com/v1.0/me/photo/$value', {
      headers: {
        Authorization: `Bearer ${req.session.accessToken}`,
      },
      responseType: 'arraybuffer',
    });

    const photoData = Buffer.from(userPhoto.data, 'binary').toString('base64');
    const photoUrl = `data:image/jpeg;base64,${photoData}`;
    
    // Store user information in session
    req.session.user = {
        wwid: userInfo.data.jobTitle, 
        name: userInfo.data.givenName + " " +userInfo.data.surname,
        data: userInfo.data,
        email: userInfo.data.mail,
        photoUrl: photoUrl
    };

    res.redirect('/');
  } catch (error) {
    console.error('Error acquiring token or fetching user data:', error);
    res.status(500).send('Error acquiring token or fetching user data');
  }
});

app.get('/userinfo', checkSession, async (req, res) => {
    res.render('userinfo', {
        title: 'User Information',
        user: req.session.user
    });
});

app.get('/about', checkSession, async (req, res) => {
    res.render('about', {
        title: 'About',
        user: req.session.user
    });
});

app.get('/dashboard', checkSession, async (req, res) => {
    res.render('dashboard', {
        title: 'Dashboard',
        user: req.session.user
    });
});


app.get('/test', checkSession, async (req, res) => {
    res.render('test', {
        title: 'Test',
        user: req.session.user
    });
});



app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});