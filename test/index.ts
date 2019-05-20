// Replace platform-specific code with a customizable mockup for testing.

import './platform';
require.cache[require.resolve('../src/platform')] = require.cache[require.resolve('./platform')];

import './NodeResolve.test';
import './JS.test';
