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
const https = require('https');


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

app.use(express.json({ limit: '10mb', extended: true }));

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
    
    const [isadmin, fisadmin] = await db.query('SELECT CASE WHEN COUNT(*) > 0 THEN \'TRUE\' ELSE \'FALSE\' END AS isAdmin FROM vip_list WHERE username = ?;', userInfo.data.mail)

    const [userExists, fue] = await db.query('SELECT EXISTS ( SELECT 1 FROM pses WHERE email = ?) AS email_exists;', [userInfo.data.mail])
    
    if(!userExists[0]['email_exists']){
      await db.query('INSERT INTO pses (email, github, type) VALUES (?,?,?);',[userInfo.data.mail, '', 'guest'])
    }

    const [userExtraInfo, fxtraInfo] = await db.query('SELECT * FROM pses WHERE email = ?', userInfo.data.mail)
   
    // Store user information in session
    req.session.user = {
        wwid: userInfo.data.jobTitle,
        idsid: userExtraInfo[0].idsid,
        name: userInfo.data.givenName + " " +userInfo.data.surname,
        githubAlias: userExtraInfo[0].github, 
        //data: userInfo.data,
        email: userInfo.data.mail,
        extra: isadmin[0]['isAdmin'],
        type: userExtraInfo[0].type,
        photoUrl: photoUrl
    };

    res.redirect('/');
  } catch (error) {
    console.error('Error acquiring token or fetching user data:', error);
    res.status(500).send('Error acquiring token or fetching user data');
  }
});

async function updatePSEInfo(req){
  const [userExtraInfo, fxtraInfo] = await db.query('SELECT * FROM pses WHERE email = ?', req.session.user.email)
  req.session.user.githubAlias = userExtraInfo[0].github;
  req.session.user.type = userExtraInfo[0].type;
  req.session.user.idsid = userExtraInfo[0].idsid;

  req.session.save();
}

app.get('/about', checkSession, async (req, res) => {
    await updatePSEInfo(req);
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

    await updatePSEInfo(req);

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
          'Authorization': process.env.GITHUB_TOKEN,
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

// get SSU url from github data
async function findSSUpath(context, id) {
    console.log('[CASO '+ id + '] > [FINDSSU]')
    try {
        const regex = /https:\/\/github\.com\/user-attachments\/files\/\d+\/[^)]+/;
        result = context.match(regex)[0];
        console.log('[CASO '+ id + '] > [FINDSSU] '+ result); 
        console.log('[CASO '+ id + '] > [FINDSSU] -fin')
        return result;
    } catch (err) {
        console.log('[CASO '+ id + '] > [WARNING] SSU not found!')
        return "null"
    }
}

// Split SSU file in three sections: SSULog, WinLog, DXdiag
async function splitSSUFile(ssuURL, id, fileContents = null) {
  try {
    const delimiter = '...#SSU#...';
    const partsArray = [];
    let buffer = '';

    // If fileContents are provided (from a local upload), parse directly
    if (fileContents) {
      let parts = fileContents.split(delimiter);
      parts.forEach(part => partsArray.push(part.trim()));
      console.log('[CASO ' + id + '] > [SSUraw] - local file parsed');
      return partsArray;
    }

    // Otherwise, fetch and stream remote file as before
    console.log('[CASO ' + id + '] > [SSUraw]');
    const response = await axios.get(ssuURL, { httpsAgent: proxyAgent, responseType: 'stream' });

    const writableStream = new Writable({
      write(chunk, encoding, callback) {
        buffer += chunk.toString();
        let parts = buffer.split(delimiter);
        buffer = parts.pop();
        parts.forEach(part => partsArray.push(part.trim()));
        callback();
      }
    });

    await new Promise((resolve, reject) => {
      writableStream.on('finish', resolve);
      writableStream.on('error', reject);
      response.data.pipe(writableStream);
    });

    response.data.on('end', () => {
      if (buffer) {
        partsArray.push(buffer.trim());
      }
      console.log('Stream complete');
    });

    console.log('[CASO ' + id + '] > [SSUraw] -fin');
    return partsArray;

  } catch (err) {
    console.log('[CASO ' + id + '] > [ERROR] SSUraw - ' + err);
    return false;
  }
}

app.get('/githubupdate/:id', async (req, res) => {
  let id = req.params.id;
  let caseInfo = await api_github_call(id);
  let commentsInfo = await api_github_call(id + "/comments")

  if(!caseInfo || !commentsInfo) {
    const err = new Error("Github Case " + id + " doesn't exist!");
    err.status = 606;
    res.status(606).render('error', { error: err });
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
        //res.redirect('/dashboard');
      } else {
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


  console.log('[CASO '+ req.body.caseInfo.number + ']')
  let caseAnalysis = false;


  // Input for case and comments
  const inputCase = "User: "+ req.body.caseInfo.user.login + " Case Number: "+ req.body.caseInfo.number + " Title: "+ req.body.caseInfo.title + "\nDescription: " + req.body.caseInfo.body;

  const inputComments = "Case description: " + req.body.caseInfo.body + " Comments: " + JSON.stringify(req.body.commentsInfo);
 

  // ssu prompt
  ssuURL = await findSSUpath(inputCase, req.body.caseInfo.number)
  ssuParts = await splitSSUFile(ssuURL, req.body.caseInfo.number); 
 
 
  const case_num = req.body.caseInfo.number;
  // iGPT calls
  [caseAnalysis, sentimentAnalysis, ssuAnalysis, logAnalysis, dxAnalysis] = await Promise.all([
    invokeModel2("case", "github", inputCase, case_num, false),
    invokeModel2("sentiment", "sentiment", inputComments, case_num, false),
    invokeModel2("ssu", "ssu", ssuParts[0], case_num, true),
    invokeModel2("winlogs", "logEvents", ssuParts[1], case_num, true),
    invokeModel2("dxlogs", "dxdiag", ssuParts[2], case_num, true),
  ]);
 
  const analysis = {
    "SSU-path" : ssuURL,
    "SSU-analysis" : ssuAnalysis, 
    "LogEvents-analysis" : logAnalysis, 
    "DXDiag-analysis" : dxAnalysis,  
    "sentiment-analysis" : sentimentAnalysis,   
    "case-analysis": caseAnalysis
  }


  const connection = await db.getConnection(); 

  try {
    await connection.beginTransaction();

    console.log('[CASO '+ req.body.caseInfo.number + '] > [UPDATEDB]');
    [update, t] = await connection.query(
    `UPDATE cases SET last_date = ?, ai_analysis = ?, ai_logs = ?, ai_feedback= ?, pse_list= ?, isvc_num= ?, sentiment= ?, case_info= ?, raw= ?  WHERE github_num = ?`,
    [ 
      dateTime, 
      JSON.stringify(caseAnalysis), 
      JSON.stringify(ssuAnalysis), 
      JSON.stringify(sentimentAnalysis), 
      JSON.stringify(sentimentAnalysis.pses), 
      null, 
      sentimentAnalysis.case_sentiment, 
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
          JSON.stringify(caseAnalysis), 
          JSON.stringify(ssuAnalysis), 
          JSON.stringify(sentimentAnalysis), 
          JSON.stringify(sentimentAnalysis.pses), 
          null, 
          sentimentAnalysis.case_sentiment, 
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
  res.sendStatus(200); 

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

    let pses = [];
    if(req.session.user.type == "admin"){
      [pses, ff] = await db.query('SELECT email FROM pses')
    } else {
      pses = [{"email" : req.session.user.email}]
    }

   
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

app.get('/dashboard/fetch-all/:status', checkSession, async (req, res) => {
  let status = req.params.status;
  let query = `SELECT * FROM cases`;
  let qarg = [];
  if(req.session.user.type == 'admin') {
    if(status == "open") {
      query += ` WHERE JSON_UNQUOTE(JSON_EXTRACT(case_info, \'$.state\')) = "open"`;
    }
    query +=` ORDER BY github_num DESC;`
  } else {
    query += " WHERE";
    if(status == "open") {
      query += ` JSON_UNQUOTE(JSON_EXTRACT(case_info, \'$.state\')) = "open" AND`;
    }
    query += ` (JSON_CONTAINS(pse_list, ?) OR pse_list LIKE ? OR owner = ? OR owner = ? ) ORDER BY github_num DESC;`
    qarg = [JSON.stringify([req.session.user.githubAlias]),'%No PSEs involved in the comments%', req.session.user.email, ""];
  }

  let [rows, f] = await db.query(query, qarg)

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
  let [rows, f] = await db.query('SELECT * FROM cases ORDER BY github_num DESC WHERE github_num = ?;', id)
    
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

  const [rows, f] = await db.query('SELECT * FROM pses WHERE email = ?;', req.session.user.email);
  await updatePSEInfo(req);

  res.render('userinfo', {
      title: 'User Information',
      user: req.session.user,
      pse: rows[0]
  });
});

app.post('/users/githubalias/:id', async (req, res) => {
  const github_alias = req.body.new_value;
  const user_id = parseInt(req.params.id, 10);
  await db.query('UPDATE pses SET github = ? WHERE id = ?', [github_alias, user_id ]);
  res.status(200).send('Github alias updated successfully');
});

app.post('/users/idsid/:id', async (req, res) => {
  const idsid = req.body.new_value;
  const user_id = parseInt(req.params.id, 10);
  await db.query('UPDATE pses SET idsid = ? WHERE id = ?', [idsid, user_id ]);
  res.status(200).send('idsid updated successfully');
});

app.get('/cases/latest', async (req, res) => {
  let [rows, f] = await db.query('SELECT MAX(github_num) FROM cases;')
  res.send(rows[0]['MAX(github_num)'].toString());
});

app.get('/cases/open-list', async(req, res)=> {
  let [rows, f] = await db.query(`
    SELECT JSON_ARRAYAGG(github_num ORDER BY github_num ASC) AS numbers
    FROM cases
    WHERE JSON_UNQUOTE(JSON_EXTRACT(case_info, '$.state')) = "open"
  `);
  res.send(rows[0].numbers);
});

app.get('/cases/count', async(req,res)=> {

  const [counts] = await db.query(`
    SELECT
      COUNT(*) AS totalCases,
      SUM(CASE WHEN JSON_UNQUOTE(JSON_EXTRACT(case_info, '$.state')) = "closed"
                AND isvc_url IS NOT NULL AND hsd <> "" THEN 1 ELSE 0 END) AS L5closed,
      SUM(CASE WHEN JSON_UNQUOTE(JSON_EXTRACT(case_info, '$.state')) = "closed"
                AND isvc_url IS NOT NULL AND hsd = "" THEN 1 ELSE 0 END) AS L4closed,
      SUM(CASE WHEN JSON_UNQUOTE(JSON_EXTRACT(case_info, '$.state')) = "closed"
                AND isvc_url IS NULL THEN 1 ELSE 0 END) AS NoISVCclosed,
      SUM(CASE WHEN JSON_UNQUOTE(JSON_EXTRACT(case_info, '$.state')) = "open"
                AND isvc_url IS NOT NULL AND hsd <> "" THEN 1 ELSE 0 END) AS L5open,
      SUM(CASE WHEN JSON_UNQUOTE(JSON_EXTRACT(case_info, '$.state')) = "open"
                AND isvc_url IS NOT NULL AND hsd = "" THEN 1 ELSE 0 END) AS L4open,
      SUM(CASE WHEN JSON_UNQUOTE(JSON_EXTRACT(case_info, '$.state')) = "open"
                AND isvc_url IS NULL THEN 1 ELSE 0 END) AS NoISVCopen
    FROM cases
  `);
  await db.query(
    `UPDATE numeros
      SET l4open = ?, l4closed = ?, l5open = ?, l5closed = ?, NoISVCopen = ?, NoISVCclosed = ?, totalCases = ?
    WHERE id = 0`,
    [
      counts[0].L4open, counts[0].L4closed, counts[0].L5open, counts[0].L5closed,
      counts[0].NoISVCopen, counts[0].NoISVCclosed, counts[0].totalCases
    ]
  );
  res.send(200);
});

app.get('/numeros/all', async(req,res)=> {
  const response = await fetch("http://localhost:3000/cases/count/");
  let [rows, f] = await db.query('SELECT * FROM numeros WHERE id = 0')
  res.json(rows);
});

app.get('/numeros/:from', async(req,res)=> {
  let email = req.params.from;
  let [rows, f] = await db.query(`
    SELECT 
    COUNT(*) as totalCases,
    SUM (CASE WHEN JSON_UNQUOTE(JSON_EXTRACT(case_info, '$.state')) = "closed"
         THEN 1 ELSE 0 END) as closedCases,
    SUM (CASE WHEN JSON_UNQUOTE(JSON_EXTRACT(case_info, '$.state')) = "open"
         THEN 1 ELSE 0 END) as openCases      
    FROM cases WHERE owner = ?`,[email]);
  res.json(rows);
})

app.get('/hsdes', checkSession, async(req,res) => {
    res.render('hsd-list', {
      title: 'HSDES tickets',
      user: req.session.user
  });
});

app.get('/hsd/fetch-mine/:text', checkSession, async(req,res) => {


  let idsid = req.session.user.idsid;
  let text = req.params.text;
  let data;
  if(idsid == ""){
    data= [];
  }else {
    const base64 = Buffer.from(process.env.HSD_TOKEN).toString('base64');
    const agent = new https.Agent({ rejectUnauthorized: false });
    const extra = text != "all"? "and title CONTAINS '%"+ text +"%'" : "";
    
    const eql_string = "select title, status, reason,  ip_sw_graphics.bug.submitted_by as 'submitted_by', ip_sw_graphics.bug.ics_owner as 'ics_owner', ip_sw_graphics.bug.submitted_date as 'submitted_date' where tenant = 'ip_sw_graphics' and subject = 'bug' "+extra+" and (ip_sw_graphics.bug.submitted_by= '"+ idsid +"' or ip_sw_graphics.bug.ics_owner = '"+ idsid +"') SORTBY submitted_date DESC"
    let bdata = await axios.post("https://hsdes-api.intel.com/rest/auth/query/execution/eql/?start_at=1&max_results=1000",
      { eql: eql_string   
      },  // Data body
      {
        headers: {
          "Authorization": "Basic " + base64,
          "content-type": "application/json"
        },
        httpsAgent: agent 
      }
    )
    // 
    for (const row of bdata.data.data) {
      const sql = `
          SELECT github_num
          FROM cases
          WHERE
            CAST(REGEXP_SUBSTR(hsd, '[0-9]+$') AS UNSIGNED) = ?
          LIMIT 1
        `;
      const [rows] = await db.query(sql, [row.id]);
      row.github_num = rows[0]?.github_num || null;

      const submittedDate = new Date(row.submitted_date);
      const today = new Date();

      const msPerDay = 24 * 60 * 60 * 1000;
      const age = Math.ceil((today - submittedDate) / msPerDay);
      row.age = age;
    };
    data = bdata.data.data
  }
  res.json(data)
});

app.get('/hsd/fetch/:text', async(req,res) => {
  let text= req.params.text;
  const base64 = Buffer.from(process.env.HSD_TOKEN).toString('base64');
  const agent = new https.Agent({ rejectUnauthorized: false });
  
  let bdata = await axios.post("https://hsdes-api.intel.com/rest/auth/query/execution/eql/?start_at=1&max_results=1000",
    { eql: "select title, status, reason, ip_sw_graphics.bug.submitted_date as 'submitted_date', ip_sw_graphics.bug.submitted_by as 'submitted_by', ip_sw_graphics.bug.ics_owner as 'ics_owner' where tenant = 'ip_sw_graphics' and subject = 'bug' and title CONTAINS '%"+ text +"%' SORTBY submitted_date DESC"        
    },  // Data body
    {
      headers: {
        "Authorization": "Basic " + base64,
        "content-type": "application/json"
      },
      httpsAgent: agent 
    }
  )
  for (const row of bdata.data.data) {
    const submittedDate = new Date(row.submitted_date);
    const today = new Date();

    const msPerDay = 24 * 60 * 60 * 1000;
    const age = Math.ceil((today - submittedDate) / msPerDay);
    row.age = age;
  };
  res.json(bdata.data.data)
});

app.get('/old_test', async (req, res) => {
    res.render('test', {
        title: 'Test',
        user: req.session.user
    });
});

app.get('/beta/prompt/:source', async (req, res) =>{
  let source = req.params.source;
  [data, t] = await db.query('SELECT data FROM prompts WHERE name= ?',[source])
  res.json(data)
});

function extractJSON(text) {
  const results = [];
  let start = -1, depth = 0;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (c === '{' || c === '[') {
      if (depth === 0) start = i;
      depth++;
    } else if (c === '}' || c === ']') {
      depth--;
      if (depth === 0 && start !== -1) {
        const candidate = text.slice(start, i + 1);
        try {
          // Parse to confirm valid JSON
          const obj = JSON.parse(candidate);

          // Convert back to a JSON string
          const jsonString = JSON.stringify(obj, null, 2);

          results.push(jsonString);
        } catch {
          // Ignore malformed JSON segments
        }
        start = -1;
      }
    }
  }

  return results;
}

async function trimContentByTokens(content, case_num, from, maxTokens) {
  const llama3TokenizerModule = await import('llama3-tokenizer-js');
  const tokenizer = llama3TokenizerModule.default;
  // Tokenize input (this is synchronous)
  const encoded = tokenizer.encode(content);
  
  if (encoded.length > maxTokens) {
    console.log('[CASO ' + case_num + '] > [INVOKEMODEL] ' + from +
      ' -content size too large: ' + encoded.length + " tokens.");
    // Truncate tokens
    const truncatedInputIds = encoded.slice(0, maxTokens);
    // Decode truncated tokens back to text (synchronous)
    const truncatedContent = tokenizer.decode(truncatedInputIds);
    console.log('[CASO ' + case_num + '] > [INVOKEMODEL] ' + from +
      ' -content size reduced to ' + maxTokens + " tokens.");
    return truncatedContent;
  }
  return content;
}

async function invokeModel2(from, prompt, content, case_num, heavy, testing=false){

  let maxTokens = 70000;
  if (content == "" || content == undefined) {
    return "false";
  }

  content = await trimContentByTokens(content, case_num, from, maxTokens);

  try {
    headers = {
      "Content-Type": "application/json"
    };

    if (testing) {
      sysPrompt = prompt;
    } else {
      [temp, t] = await db.query('SELECT data FROM prompts WHERE name= ?',[prompt])
      sysPrompt = temp[0].data;
    }

    if (heavy){
      url = "http://10.105.184.156:8001/v1/chat/completions";
      model = "meta-llama/Llama-3.1-8B-Instruct"
    }else {
      url = "http://10.105.184.156:8000/v1/chat/completions";
      model = "meta-llama/Llama-3.3-70B-Instruct"
    }
    console.log('[CASO '+ case_num +'] > [INVOKEMODEL] '+ from +': ' + model);

    data = {
      "model": model,
      "max_tokens": 4000,
      "temperature": 0.2,
      "top_P": 0.40,
      "messages": [
        {
          "role": "system",
          "content": sysPrompt
        },
        {
          "role": "user",
          "content": content
        }
      ]
    };


    response = await axios.post(url, data, { httpsAgent: proxyAgent, headers: headers});
    console.log('[CASO '+ case_num +'] > [INVOKEMODEL] '+ from +' -fin');
    r = response.data.choices[0].message.content;
    return r ? JSON.parse(extractJSON(r)[0]) : "false";
    

  } catch (err) {
      console.log(err.response);
      console.log('[CASO '+ case_num +'] > [INVOKEMODEL] '+ from +' > ' +err);
      return "false"
  }
}

app.post('/beta/call/', async (req, res) => {
  const prompt = req.body.prompt;
  const caseNum = req.body.caseNumber;
  const type = req.body.type;
  const data = req.body.data;
 
  let result = "<empty>";
  switch(type){
    case "github":
      caseInfo = await api_github_call(caseNum);
      content = "User: "+ caseInfo.user.login + " Case Number: "+ caseInfo.number + " Title: "+ caseInfo.title + "\nDescription: " + caseInfo.body
      result = await invokeModel2("test", prompt, content, caseNum, false, true);
      break;
    case "SSU":
      ssuParts = await splitSSUFile("nada", caseNum, data); 
      content = ssuParts[0]
      result = await invokeModel2("test", prompt, content, caseNum, true, true);
      break;
    case "Sentiment":
      caseInfo = await api_github_call(caseNum);
      commentsInfo = await api_github_call(caseNum + "/comments")
      content = "Case description: " + caseInfo.body + " Comments: " + JSON.stringify(commentsInfo);
      result = await invokeModel2("test", prompt, content, caseNum, false, true);
      break;
    case "WindowsLogs":
      ssuParts = await splitSSUFile("nada", caseNum, data); 
      content = ssuParts[1];
      result = await invokeModel2("test", prompt, content, caseNum, true, true);
      break;
    case "DxDiag":
      ssuParts = await splitSSUFile("nada", caseNum, data); 
      content = ssuParts[2]
      result = await invokeModel2("test", prompt, content, caseNum, true, true);
      break;
    case "test":
      console.log("hello");
      content = data;
      result = await invokeModel2("test", prompt, content, caseNum, true, true);
      break;
  }
  res.json(result);

})

app.get('/beta/hsdhistory/:id', async (req,res) =>{

  let id = req.params.id;
  const base64 = Buffer.from(process.env.HSD_TOKEN).toString('base64');
  const agent = new https.Agent({ rejectUnauthorized: false });

  try{
    let resp = await axios.get("https://hsdes-api.intel.com/rest/auth/article/" + id + "/history?fields=id%2Cip_sw_graphics.bug.team%2Cinternal_summary%2Cowner%2Ctitle%2Cstatus%2Cstatus_reason%2Cupdated_date%2Cupdated_by",
      {
        headers: {
          "Authorization": "Basic " + base64,
          "content-type": "application/json"
        },
        httpsAgent: agent 
      }
    );
    console.log(resp.data);
  }catch(err){
    console.log(err);
    res.status(err.status).send(err.response.data.message);
  }
  res.status(200).send('-fin');
});

app.post('/hsd/push', async (req, res) => {
  const base64 = Buffer.from(process.env.HSD_TOKEN).toString('base64');
  const agent = new https.Agent({ rejectUnauthorized: false });
  const data = req.params.description; //`` 
  try{
    let resp = await axios.post("https://hsdes-api.intel.com/rest/auth/article/",
      { 
        "tenant": "ip_sw_graphics",
        "subject": "bug",
        "fieldValues": [ data ] 
      }, // Data body
      {
        headers: {
          "Authorization": "Basic " + base64,
          "content-type": "application/json"
        },
        httpsAgent: agent 
      }
    );
    console.log(resp);
  }catch (err) {  
    console.log(err);
    res.status(err.status).send(err.response.data.message);
  }
  
  res.status(200).send('-fin');

});

app.get('/beta', checkSession, async (req, res) => {
      res.render('beta', {
        title: 'BETA',
        user: req.session.user
    });
});

app.use((req, res, next) => {
  res.locals.user = req.session.user;
  next();
});

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
