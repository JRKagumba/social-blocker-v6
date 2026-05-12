// Test stub for electron module so the production code can be loaded under plain node.
const os = require('os');
module.exports = {
    app: {
        getPath: (key) => key === 'temp' ? os.tmpdir() : os.tmpdir(),
        getName: () => 'Social Blocker v6 (test)',
        isPackaged: false,
    },
    ipcMain: { handle: () => {}, on: () => {} },
    BrowserWindow: class { },
    Tray: class { setToolTip(){} setContextMenu(){} on(){} destroy(){} isDestroyed(){return false;} },
    Menu: { buildFromTemplate: () => ({}) },
    Notification: { isSupported: () => false },
};
