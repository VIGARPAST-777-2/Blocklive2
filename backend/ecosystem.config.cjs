if (process.env.NODE_ENV !== 'production') {
    const result = require('dotenv').config();
    if (result.error) {
        console.warn('No .env file found, skipping .env load (development only).');
    }
}

module.exports = {
    apps: [
        {
            name: "LiveScratch",
            script: "./index.js",
            killTimeout: 60000,
            env: {
                PORT: process.env.PORT,
                CHAT_WEBHOOK_URL: process.env.CHAT_WEBHOOK_URL,
                ADMIN_USER: process.env.ADMIN_USER,
                AUTH_PROJECTS: process.env.AUTH_PROJECTS,
                ADMIN: process.env.ADMIN,
            }
        }
    ]
};
