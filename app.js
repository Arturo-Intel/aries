require('dotenv').config();
const express = require('express');
const session = require('express-session');
const msal = require('@azure/msal-node');
const axios = require('axios');
const authConfig = require('./authConfig');
const ejsMate = require('ejs-mate');
const db = require('./db'); 
const tools = require('./tools');
const cors = require('cors');
const bodyParser = require('body-parser');

const { Writable } = require('stream');

const { HttpsProxyAgent } = require('https-proxy-agent');
const proxyAgent = new HttpsProxyAgent('http://proxy-chain.intel.com:912');



const app = express();
const port = process.env.PORT || 3000;

//app.set('trust proxy', 1);

// Set EJS as the template engine
app.engine('ejs', ejsMate);
app.set('view engine', 'ejs');
app.set('views', __dirname + '/views');

// Serve static files from the public directory
app.use(express.static('public'));

// Middleware to parse request bodies
app.use(bodyParser.urlencoded({ extended: true }));

// Set up session middleware
app.use(session({
  secret: 'aries_secret_key_5', // Replace with a strong secret key
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: false,
    httpOnly: true, // Prevent client-side JavaScript from accessing the cookie
    maxAge: 3600000 // Set session expiration to 1 hour (in milliseconds)
  } 
}));

app.use(express.json());

app.use(cors());
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

async function invokeModel(input, prompt, token, from, id){
  try {
    console.log('[CASO '+ id + '] > [INVOKEMODEL] ' + from);
    if(input == "" || input == undefined){
      return false;
    } 

    let maxLines = 4000
    if (input.split('\n').length > maxLines) {
      console.log('[CASO ' + id + '] > [INVOKEMODEL] '+from+' -input size too large: ' + input.split('\n').length + " lines." );
      input = input.split('\n').slice(0, maxLines).join('\n');
      console.log('[CASO ' + id + '] > [INVOKEMODEL] '+from+' -input size reduced to ' + maxLines + " lines.");
    }
    const url = "https://apis-internal.intel.com/generativeaiinference/v1";
    headers = {
        "Authorization": "Bearer " + token,
        "Content-Type": "application/json"
    };
    data = {
        "correlationId": "string",
        "options": {
            "temperature": 0.2,
            "top_P": 0.40,
            "frequency_Penalty": 0,
            "presence_Penalty": 0,
            "max_Tokens": 4000,
            "stop": null,
            "model": "gpt-4o",
            "allowModelFallback": true 
        },
        "conversation": [
            {
                "role": "system",
                "content": prompt
            },
            {
                "role": "user",
                "content": input
            }
        ]
    };

    response = await axios.post(url, data, { httpsAgent: proxyAgent, headers: headers});
    console.log('[CASO ' + id + '] > [INVOKEMODEL] '+ from +' -fin');
    return response.data.conversation[2].content;

  }catch (err) {
      console.log('[CASO ' + id + '] > [ERROR] invokeModel '+ from + ' > ' +err);
      return false
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
    
    const [result, f] = await db.query('SELECT CASE WHEN COUNT(*) > 0 THEN \'TRUE\' ELSE \'FALSE\' END AS isAdmin FROM vip_list WHERE username = ?;', userInfo.data.mail)

    // Store user information in session
    req.session.user = {
        wwid: userInfo.data.jobTitle, 
        name: userInfo.data.givenName + " " +userInfo.data.surname,
        givenName: userInfo.data.givenName, 
        data: userInfo.data,
        email: userInfo.data.mail,
        extra: result[0]['isAdmin'],
        photoUrl: photoUrl
    };

    res.redirect('/');
  } catch (error) {
    console.error('Error acquiring token or fetching user data:', error);
    res.status(500).send('Error acquiring token or fetching user data');
  }
});

app.get('/about', checkSession, async (req, res) => {
    res.render('about', {
        title: 'About',
        user: req.session.user
    });
});

app.get('/dashboard', checkSession, async (req, res) => {
    try {
      var form_data = {
          datetime: tools.getDateTime(),
          action: "Landing page",
          username: req.session.user.email,
          result: "OK"            
      }
    } catch (err) {
      res.redirect('/login');
    }

    try {
        const r = await db.query('INSERT INTO activity_log SET ?', form_data)
    } catch (err) {
        console.error("Error save data: ", err)
    }
    
    
    // let [rows, f] = [null, null]
    // if(req.session.user.extra == 'TRUE') {
    //   [rows, f] = await db.query('SELECT * FROM cases ORDER BY github_num DESC;')
    // } else {
    //   [rows, f] = await db.query('SELECT * FROM cases WHERE pse_list LIKE \'%'+req.session.user.givenName+'%\' OR pse_list LIKE \'%No PSEs involved in the comment%\' ORDER BY github_num DESC')
    // }
    // rows.forEach((row, i) => {
    
    //   row.ai_analysis =  row.ai_analysis !== undefined ? JSON.parse(row.ai_analysis) : "{}"
    //   row.ai_logs = row.ai_logs !== undefined ? JSON.parse(row.ai_logs) : "{}"
    //   row.ai_feedback = row.ai_feedback !== undefined ? JSON.parse(row.ai_feedback) : "{}"
    //   row.pse_list = JSON.parse(row.pse_list);
    //   row.case_info = row.case_info !== undefined ? JSON.parse(row.case_info) : "{}"
    //   row.raw = row.raw !== undefined ? JSON.parse(row.raw) : "{}"

    // });


    res.render('dashboard', {
        title: 'Dashboard', 
        user: req.session.user,
        // data: rows ,
        formatSQLDate: tools.formatSQLDate
    });
});

 async function api_github_call(id) {
    const api_url = 'https://api.github.com/repos/IGCIT/Intel-GPU-Community-Issue-Tracker-IGCIT/issues/';
    const headers = {
            'Authorization': "token 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",
            'Accept': 'application/vnd.github.v3+json'
          };
    const url = api_url + id;
    try {    
        const res2 = await axios.get(url, {httpsAgent: proxyAgent,  headers: headers});
        console.log("[OK] github api call: " + url)
        return res2.data;
    } catch (error) {
        console.log("[GitHub API] " + error);
        return false;
    }
  }


app.get('/githubupdate/:id', async (req, res) => {
  let id = req.params.id;
  let caseInfo = await api_github_call(id);
  let commentsInfo = await api_github_call(id + "/comments")

if(!caseInfo || !commentsInfo) {
//  const err = new Error('Something went wrong!');
//  err.status = 500; 
//  next(err); 
res.status(500).render('error', {error:  new Error("Github Case "+id +" doesn't exists!")});
}else {

  try {
    data = JSON.stringify({
            "caseInfo": caseInfo, 
            "commentsInfo": commentsInfo,
            "num" : id
        });

    const response = await fetch("http://localhost:3000/cerebro", {
        method: 'POST',
        headers: {
                  "Content-Type": "application/json"
                 },
        body: data
    });

   if (response.ok) {
      res.redirect('/github/'+id);
    } else {
      //res.redirect("/dashboard");
      res.status(500).send('error');
    }

  } catch (e) {
    console.error('Error:', e);
    res.status(500).send('Internal server error');
  }
}
});

app.post('/cerebro', async (req, res) => {
  const dateTime = tools.getDateTime();


  // Get prompts for db
  async function getPrompts(){
    try {
      console.log('[CASO '+ req.body.caseInfo.number + '] > [GETPROMPTS]');
      [allPrompt, t] = await db.query('SELECT data FROM prompts')
      githubPrompt = allPrompt[0].data;
      sentimentPrompt = allPrompt[1].data;
      ssuPrompt = allPrompt[2].data;
      logPrompt = allPrompt[3].data;
      dxPrompt = allPrompt[4].data;
      console.log('[CASO '+ req.body.caseInfo.number + '] > [GETPROMPTS] -fin');
    } catch (err) {
        console.error("Error getting prompt: ", err)
    }
  }

  // get iGPT token
  async function getTokeniGPT(){
    try {
        console.log('[CASO '+ req.body.caseInfo.number + '] > [TOKEN]');
        const url = "https://apis-internal.intel.com/v1/auth/token";
        data = {
            "grant_type": "client_credentials",
            "client_id": process.env.CLIENT_ID_AI,
            "client_secret": process.env.CLIENT_SECRET_AI
        };
        headers = {
            "Content-Type": "application/x-www-form-urlencoded"
        };
        const response = await axios.post(url, data, { httpsAgent: proxyAgent, headers: headers, timeout: 3000});
        console.log('[CASO '+ req.body.caseInfo.number + '] > [TOKEN] -fin');
        return response.data.access_token;
    }catch (err) {
        console.log('[CASO '+ req.body.caseInfo.number + '] > [ERROR] token > ' + err)
    }
  }

  // get SSU url from github data
  async function findSSUpath(context) {
      console.log('[CASO '+ req.body.caseInfo.number + '] > [FINDSSU]')
      try {
          const regex = /https:\/\/github\.com\/user-attachments\/files\/\d+\/[^)]+/;
          result = context.match(regex)[0];
          console.log('[CASO '+ req.body.caseInfo.number + '] > [FINDSSU] '+ result); 
          console.log('[CASO '+ req.body.caseInfo.number + '] > [FINDSSU] -fin')
          return result;
      } catch (err) {
          console.log('[CASO '+ req.body.caseInfo.number + '] > [WARNING] SSU not found!')
          return "null"
      }
  }

  // Split SSU file in three sections: SSULog, WinLog, DXdiag
  async function splitSSUFile(ssuURL){
    try {
      const delimiter = '...#SSU#...';
      console.log('[CASO '+ req.body.caseInfo.number + '] > [SSUraw]')
      const response = await axios.get(ssuURL, { httpsAgent: proxyAgent, responseType: 'stream' });
      const partsArray = [];
      let buffer = '';

      const writableStream = new Writable({
        write(chunk, encoding, callback) {
          buffer += chunk.toString();

          let parts = buffer.split(delimiter);
          buffer = parts.pop(); // Keep the last part in the buffer

          parts.forEach((part) => {
            partsArray.push(part.trim());
          });

          callback();
        }
      });

      response.data.pipe(writableStream);

      writableStream.on('finish', () => {
        if (buffer) {
          partsArray.push(buffer.trim()); // Add any remaining data in the buffer
        }
      });

      writableStream.on('error', (error) => {
        console.error('Error processing file:', error);
      });

      console.log('[CASO '+ req.body.caseInfo.number + '] > [SSUraw] -fin')      
      return partsArray;

    } catch (err) {
      console.log('[CASO '+ req.body.caseInfo.number + '] > [ERROR] SSUraw - ' + err)
      return false;
    }
  }

  console.log('[CASO '+ req.body.caseInfo.number + ']')
  let igptToken = false;
  let caseAnalysis = false;
  let githubPrompt = false;
  let sentimentPrompt = false;
  let ssuPrompt = false;
  let logPrompt = false;
  let dxPrompt = false;

  // Input for case and comments
  const inputCase = "User: "+ req.body.caseInfo.user.login + " Case Number: "+ req.body.caseInfo.number + " Title: "+ req.body.caseInfo.title + "\n" + req.body.caseInfo.body;
  const inputComments = "Case description: " + req.body.caseInfo.body + " Comments: " + JSON.stringify(req.body.commentsInfo);
 

  await getPrompts();
  // ssu prompt
  ssuURL = await findSSUpath(inputCase)
  ssuParts = await splitSSUFile(ssuURL); 
  igptToken = await getTokeniGPT();

 

  // iGPT calls
  [caseAnalysis, commentsAnalysis, ssuAnalysis, logAnalysis, dxAnalysis] = await Promise.all([
    invokeModel(inputCase, githubPrompt, igptToken, "case", req.body.caseInfo.number),
    invokeModel(inputComments, sentimentPrompt, igptToken, "comments", req.body.caseInfo.number),
    invokeModel(ssuParts[0], ssuPrompt, igptToken, "SSU", req.body.caseInfo.number),
    invokeModel(ssuParts[1], logPrompt, igptToken, "Logs", req.body.caseInfo.number),
    invokeModel(ssuParts[2], dxPrompt, igptToken, "DxDiag", req.body.caseInfo.number),
  ]);
 
  //cleaning up returned JSONs
  try{
    caseJSON = JSON.parse(caseAnalysis.match(/\{(?:[^{}]*|\{(?:[^{}]*|\{[^{}]*\})*\})*\}/g));
    sentimentJSON = JSON.parse(commentsAnalysis.match(/\{(?:[^{}]*|\{(?:[^{}]*|\{[^{}]*\})*\})*\}/g));
    ssuJSON = ssuAnalysis ? JSON.parse(ssuAnalysis.match(/\{(?:[^{}]*|\{(?:[^{}]*|\{[^{}]*\})*\})*\}/g)) : "false";
    logJSON = logAnalysis ? JSON.parse(logAnalysis.match(/\{(?:[^{}]*|\{(?:[^{}]*|\{[^{}]*\})*\})*\}/g)) : "false";
    dxJSON = dxAnalysis ? JSON.parse(dxAnalysis.match(/\{(?:[^{}]*|\{(?:[^{}]*|\{[^{}]*\})*\})*\}/g)) : "false";
  }catch (err) {
    console.log("JSON error", err)
  }

  const analysis = {
    "SSU-path" : ssuURL,
    "SSU-analysis" : ssuJSON, 
    "LogEvents-analysis" : logJSON, 
    "DXDiag-analysis" : dxJSON,  
    "sentiment-analysis" : sentimentJSON,   
    "case-analysis": caseJSON
  }

  const connection = await db.getConnection(); 

  try {
    await connection.beginTransaction();

    console.log('[CASO '+ req.body.caseInfo.number + '] > [UPDATEDB]');
    [update, t] = await connection.query(
    `UPDATE cases SET last_date = ?, ai_analysis = ?, ai_logs = ?, ai_feedback= ?, pse_list= ?, isvc_num= ?, sentiment= ?, case_info= ?, raw= ?  WHERE github_num = ?`,
    [ 
      dateTime, 
      JSON.stringify(caseJSON), 
      JSON.stringify(ssuJSON), 
      JSON.stringify(sentimentJSON), 
      JSON.stringify(sentimentJSON.pses), 
      null, 
      sentimentJSON.case_sentiment, 
      JSON.stringify(req.body.caseInfo), 
      JSON.stringify(analysis),
      req.body.caseInfo.number
    ]);

    if(update.affectedRows == 0) {
      console.log('[CASO '+ req.body.caseInfo.number + '] > [UPDATEDB] - Insert')
      await connection.query(
        'INSERT INTO cases (last_date, github_num, ai_analysis, ai_logs, ai_feedback, pse_list, isvc_num, sentiment, case_info, raw) VALUES (?,?,?,?,?,?,?,?,?,?);', 
        [ dateTime, 
          req.body.caseInfo.number, 
          JSON.stringify(caseJSON), 
          JSON.stringify(ssuJSON), 
          JSON.stringify(sentimentJSON), 
          JSON.stringify(sentimentJSON.pses), 
          null, 
          sentimentJSON.case_sentiment, 
          JSON.stringify(req.body.caseInfo), 
          JSON.stringify(analysis)
        ]);
    }
    await connection.commit();
    console.log('[CASO '+ req.body.caseInfo.number + '] > [UPDATEDB] -fin')
  } catch (err) {
    await connection.rollback();
    console.error("Error updating data: ", err)
  } finally {
    connection.release();
  }
  console.log('[CASO '+ req.body.caseInfo.number + '] -fin' );
  res.status(200).send('Processed successfully');

});

app.get('/github/:id', checkSession, async (req, res) => {
  let id = req.params.id;
  const [rows, f] = await db.query('SELECT * FROM cases WHERE github_num = ?', id)

  if(rows.length > 0) {
    const [row, rf] = await db.query('SELECT * FROM cases ORDER BY github_num DESC LIMIT 1;')
    rows.forEach((row, i) => {
      row.ai_analysis =  row.ai_analysis !== undefined ? JSON.parse(row.ai_analysis) : "{}"
      row.ai_logs = row.ai_logs !== undefined ? JSON.parse(row.ai_logs) : "{}"
      row.ai_feedback = row.ai_feedback !== undefined ? JSON.parse(row.ai_feedback) : "{}"
      row.pse_list = JSON.parse(row.pse_list);
      row.case_info = row.case_info !== undefined ? JSON.parse(row.case_info) : "{}"
      row.raw = row.raw !== undefined ? JSON.parse(row.raw) : "{}"
    });

    const [pses, ff] = await db.query('SELECT email FROM pses')
    
    res.render('details', {
      title: 'Github Case ['+ id +']', 
      user: req.session.user,
      github_id: id,
      pses: pses,
      data: rows[0],
      latest: row[0].github_num
    });
  } else {
    res.redirect('/githubupdate/'+id);
  }
});

app.post('/github/:id/update-owner', async (req, res) => {
  const selectedEmail = req.body.selectedEmail;
  const github_id = parseInt(req.params.id, 10);
  await db.query('UPDATE cases SET owner = ? WHERE github_num = ?', [selectedEmail, github_id])
  res.redirect(`/github/${github_id}`);
});

app.post('/github/:id/update-urls', async (req, res) => {
  const { type, url } = req.body;
  const github_id = parseInt(req.params.id, 10);
  let query = ""
  switch(type){
    case 'isvc':
      query="UPDATE cases SET isvc_url = ? WHERE github_num = ?";
      break;
    case 'hsd':
      query="UPDATE cases SET hsd = ? WHERE github_num = ?";
      break;
  }
  await db.query(query, [url, github_id]);
  res.status(200).send('URL updated successfully');
});

app.get('/dashboard/fetch/all', checkSession, async (req, res) => {
  let [rows, f] = [null, null]
  if(req.session.user.extra == 'TRUE') {
    [rows, f] = await db.query('SELECT * FROM cases ORDER BY github_num DESC;')
  } else {
    [rows, f] = await db.query('SELECT * FROM cases WHERE pse_list LIKE \'%'+req.session.user.givenName+'%\' OR pse_list LIKE \'%No PSEs involved in the comment%\' ORDER BY github_num DESC;')
  }
  
  rows.forEach((row, i) => {

    row.ai_analysis =  row.ai_analysis !== undefined ? JSON.parse(row.ai_analysis) : "{}"
    row.ai_logs = row.ai_logs !== undefined ? JSON.parse(row.ai_logs) : "{}"
    row.ai_feedback = row.ai_feedback !== undefined ? JSON.parse(row.ai_feedback) : "{}"
    row.pse_list = JSON.parse(row.pse_list);
    row.case_info = row.case_info !== undefined ? JSON.parse(row.case_info) : "{}"
    row.raw = row.raw !== undefined ? JSON.parse(row.raw) : "{}"

  });
  console.log(">>>.");
  res.json(rows)
});

app.get('/dashboard/fetch/:id', checkSession, async (req, res) => {
  let id = req.params.id;
  let [rows, f] = [null, null]
  if(req.session.user.extra == 'TRUE') {
    [rows, f] = await db.query('SELECT * FROM cases ORDER BY github_num DESC WHERE github_num = ?;', id)
  } else {
    [rows, f] = await db.query('SELECT * FROM cases WHERE pse_list LIKE \'%'+req.session.user.givenName+'%\' OR pse_list LIKE \'%No PSEs involved in the comment%\' ORDER BY github_num DESC WHERE github_num = ?;', id)
  }
  
  rows.forEach((row, i) => {

    row.ai_analysis =  row.ai_analysis !== undefined ? JSON.parse(row.ai_analysis) : "{}"
    row.ai_logs = row.ai_logs !== undefined ? JSON.parse(row.ai_logs) : "{}"
    row.ai_feedback = row.ai_feedback !== undefined ? JSON.parse(row.ai_feedback) : "{}"
    row.pse_list = JSON.parse(row.pse_list);
    row.case_info = row.case_info !== undefined ? JSON.parse(row.case_info) : "{}"
    row.raw = row.raw !== undefined ? JSON.parse(row.raw) : "{}"

  });
  res.json(rows)
});

app.get('/userinfo', checkSession, async (req, res) => {
    res.render('userinfo', {
        title: 'User Information',
        user: req.session.user
    });
});

app.get('/old_test', checkSession, async (req, res) => {
    res.render('test', {
        title: 'Test',
        user: req.session.user
    });
});

app.use((err, req, res, next) => {
  console.log(">>>> e "+ err);
  res.status(err.status || 500);
  res.render('error', { error: err });
});


app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
