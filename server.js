// Keep the original root start command working while the API lives in backend/.
require('./backend/server').start().catch((error) => {
  console.error(`Could not start Jampals API: ${error.message}`);
  process.exit(1);
});
