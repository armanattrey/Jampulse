const { app, BrowserWindow } = require('electron');

function createWindow() {
  const win = new BrowserWindow({ width: 1200, height: 800 });
  // Point to your running local port or built static HTML file:
  win.loadURL('http://localhost:3000'); 
}

app.whenReady().then(createWindow);