// Temporary workaround for TTPG/MacOS require node_modules bug.
// Remove this when TTPG fixes it, fix requires to use real assert.
// Usage: const assert = require('./wrapper/assert')

let assert = false;
try {
    //assert = require("assert");
} catch {
    assert = false;
}
if (!assert) {
    assert = (test, message) => {
        if (!test) {
            //console.log(new Error().stack);
            throw new Error(message ? message : "assertion failed");
        }
    };
}
module.exports = assert;
