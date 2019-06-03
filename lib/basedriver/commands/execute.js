import _ from 'lodash';
import log from '../logger';
import vm from 'vm';
import { attach } from 'webdriverio';
import { MJSONWP_ELEMENT_KEY, W3C_ELEMENT_KEY } from '../../protocol/protocol';

const BASE_PATH = '/wd/hub'; // TODO defining this here is brittle but it is hardcoded in routes, so...

let commands = {};

/*
 * TODO fill out entire docstring
 *
 * This method takes a string which is executed as javascript in the context of
 * a new nodejs VM, and which has available a webdriverio driver object, having
 * already been attached to the currently running session.
 */
commands.executeDriverScript = async function (script, scriptType) {
  if (!!scriptType && scriptType !== 'webdriverio') {
    throw new Error("Only the 'webdriverio' script type is currently supported");
    // TODO should probably add support for WD script type as well?
  }

  if (!this.opts.host || !this.opts.port) {
    throw new Error('Host or port of running server were not defined; this is required');
  }
  const driver = attach({
    sessionId: this.sessionId,
    protocol: 'http', // Appium won't ever be behind ssl locally
    hostname: this.opts.host,
    port: this.opts.port,
    path: BASE_PATH,
    isW3C: true, // TODO should probably retrieve client protocol and declare the same one for the script
    capabilities: this.caps
  });
  const fullScript = buildScript(script);
  const result = await vm.runInNewContext(fullScript)(driver);
  return coerceScriptResult(result);
};

function buildScript (script) {
  return `(async function execute (driver) {
    ${script}
  })`;
}

/*
 * We can get any manner of crazy thing back from a vm executing untrusted
 * code. We might also get WebdriverIO objects that aren't suitable for JSON
 * response. So make sure we convert the things we know about to their
 * appropriate response format, and squash other weird things.
 */
function coerceScriptResult (obj) {
  // first ensure obj is of a type that can be JSON encoded safely. This will
  // get rid of custom objects, functions, etc... and turn them into POJOs
  try {
    obj = JSON.parse(JSON.stringify(obj));
  } catch (e) {
    log.warn('Could not convert executeDriverScript to safe response!' +
             `Result was: ${obj}. Will make it null`);
    return null;
  }

  let res;

  // now we begin our recursive case options
  if (_.isPlainObject(obj)) {
    // if we have an object, it's either an element object or something else
    // TODO check whether webdriverio has any monadic object types other than
    // element, for example window
    res = {};

    if (obj[MJSONWP_ELEMENT_KEY] || obj[W3C_ELEMENT_KEY]) {
      // if it's an element object, clear out anything that's not the key, and
      // then return the object
      if (obj[MJSONWP_ELEMENT_KEY]) {
        res[MJSONWP_ELEMENT_KEY] = obj[MJSONWP_ELEMENT_KEY];
      }

      if (obj[W3C_ELEMENT_KEY]) {
        res[W3C_ELEMENT_KEY] = obj[W3C_ELEMENT_KEY];
      }
      return res;
    }

    // otherwise, recurse into the object
    for (const key of Object.keys(obj)) {
      res[key] = coerceScriptResult(obj[key]);
    }
    return res;
  }

  // in the cae of an array, just recurse into the items
  if (_.isArray(obj)) {
    return obj.map(i => coerceScriptResult(i));
  }

  // base case, if it's not an object or array, return straightaway
  return obj;
}

export default commands;
