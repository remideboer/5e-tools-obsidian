import "../../lib/elasticlunr.js";
import "../../js/parser.js";
import "../../js/utils.js";

if (!globalThis.elasticlunr && typeof elasticlunr !== "undefined") {
	globalThis.elasticlunr = elasticlunr;
}
