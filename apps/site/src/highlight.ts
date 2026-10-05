/**
 * Minimal syntax highlighting for the snippets on this page (TypeScript, JavaScript, HTML, shell).
 * Deliberately small: a handful of token classes is enough for short examples.
 */
const KEYWORDS = new Set([
    "import", "from", "export", "const", "let", "var", "new", "await", "async", "function", "return",
    "if", "else", "for", "of", "in", "while", "class", "extends", "true", "false", "undefined", "null",
    "typeof", "as", "type", "interface", "default", "throw", "try", "catch", "finally", "yield", "this"
]);

function escape(text: string): string {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const JS_TOKEN = /(\/\/[^\n]*)|(`(?:\\.|\$\{[^}]*\}|[^`\\])*`|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')|(\b\d+(?:\.\d+)?\b)|(\b[A-Za-z_$][\w$]*\b)|([{}()[\].,;:=<>+\-*/!?&|]+)/g;

export function highlightJs(source: string): string {
    let out = "";
    let last = 0;
    for (const match of source.matchAll(JS_TOKEN)) {
        const index = match.index ?? 0;
        out += escape(source.slice(last, index));
        const [text, comment, string, number, word] = match;
        if (comment) out += `<span class="tk-comment">${escape(text)}</span>`;
        else if (string) out += `<span class="tk-string">${escape(text)}</span>`;
        else if (number) out += `<span class="tk-number">${escape(text)}</span>`;
        else if (word) {
            if (KEYWORDS.has(word)) out += `<span class="tk-keyword">${word}</span>`;
            else if (/^[A-Z]/.test(word)) out += `<span class="tk-type">${word}</span>`;
            else if (source[index + text.length] === "(") out += `<span class="tk-call">${word}</span>`;
            else out += word;
        } else out += `<span class="tk-punct">${escape(text)}</span>`;
        last = index + text.length;
    }
    out += escape(source.slice(last));
    return out;
}

export function highlightHtml(source: string): string {
    // Highlight script bodies as JS and the surrounding markup as tags.
    return source.split(/(<script[^>]*>[\s\S]*?<\/script>)/g).map(part => {
        const script = /^(<script[^>]*>)([\s\S]*?)(<\/script>)$/.exec(part);
        if (script) {
            return `<span class="tk-tag">${escape(script[1])}</span>${highlightJs(script[2])}<span class="tk-tag">${escape(script[3])}</span>`;
        }
        return escape(part).replace(/(&lt;\/?)([\w-]+)([^&]*?)(\/?&gt;)/g, (_m, open, name, attrs, close) => {
            const attributes = attrs.replace(/([\w-]+)=("[^"]*")/g, '<span class="tk-attr">$1</span>=<span class="tk-string">$2</span>');
            return `<span class="tk-tag">${open}${name}</span>${attributes}<span class="tk-tag">${close}</span>`;
        });
    }).join("");
}

export function highlightShell(source: string): string {
    return source.split("\n").map(line => {
        if (line.startsWith("#")) return `<span class="tk-comment">${escape(line)}</span>`;
        const match = /^(\s*)(\S+)(.*)$/.exec(line);
        if (!match) return escape(line);
        return `${match[1]}<span class="tk-call">${escape(match[2])}</span>${escape(match[3]).replace(/(--?[\w-]+)/g, '<span class="tk-attr">$1</span>')}`;
    }).join("\n");
}

export function highlight(source: string, language: string): string {
    switch (language) {
        case "html": return highlightHtml(source);
        case "sh":
        case "bash":
        case "shell": return highlightShell(source);
        case "json":
        case "js":
        case "ts":
        case "javascript":
        case "typescript": return highlightJs(source);
        default: return escape(source);
    }
}

/** Highlights every <pre><code data-lang> block that has not been processed yet. */
export function highlightAll(root: ParentNode = document): void {
    root.querySelectorAll<HTMLElement>("pre > code[data-lang]:not([data-highlighted])").forEach(code => {
        code.innerHTML = highlight(code.textContent ?? "", code.dataset.lang ?? "");
        code.dataset.highlighted = "true";
    });
}
