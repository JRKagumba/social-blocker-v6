/**
 * Module-resolution shim so production code that does `require('electron')` etc.
 * can be loaded under plain Node for tests.
 */
const path = require('path');
const Module = require('module');

const stubs = {
    'electron': path.resolve(__dirname, 'stubs', 'electron.js'),
    'electron-store': path.resolve(__dirname, 'stubs', 'electron-store.js'),
    'sudo-prompt': path.resolve(__dirname, 'stubs', 'sudo-prompt.js'),
    'active-win': path.resolve(__dirname, 'stubs', 'active-win.js'),
};

const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
    return origResolve.call(this, request, parent, ...rest);
};
