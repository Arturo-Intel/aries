// authConfig.js
require('dotenv').config();
const AZURE_CLIENTID = process.env.AZURE_CLIENTID;
const AZURE_INSTANCE = process.env.AZURE_INSTANCE;
const AZURE_TENANTID = process.env.AZURE_TENANTID;
const AZURE_CLIENTSECRET = process.env.AZURE_CLIENTSECRET;

const config = {
  auth: {
    clientId: AZURE_CLIENTID,
    authority: `${AZURE_INSTANCE}/${AZURE_TENANTID}`,
    clientSecret: AZURE_CLIENTSECRET,
  },
  system: {
    loggerOptions: {
      loggerCallback(loglevel, message, containsPii) {
        console.log(message);
      },
      piiLoggingEnabled: false,
      logLevel: "Info",
    },
  },
};

module.exports = config;