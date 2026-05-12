module.exports = {
    exec: (_cmd, _opts, cb) => {
        if (typeof cb === 'function') cb(new Error('test-sudo-disabled'));
    }
};
