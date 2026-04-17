import json
import urllib.parse

from PyQt6.QtWebEngineCore import QWebEngineUrlSchemeHandler, QWebEngineUrlRequestJob
from PyQt6.QtCore import QBuffer, QByteArray

from .jitendex import JitendexModule
from .jmdict import JMdictModule
from .base import DictionaryModule

# Module-level singleton — Jitendex is primary, JMdict is fallback.
_module: DictionaryModule | None = None


def get_dict_module() -> DictionaryModule:
    global _module
    if _module is None:
        jitendex = JitendexModule()
        _module = jitendex if jitendex.is_available else JMdictModule()
    return _module


class DictionaryUrlSchemeHandler(QWebEngineUrlSchemeHandler):
    """Handles  immersion://dict/lookup?text=<url-encoded-text>  requests
    that originate from the injected overlay.js running inside browser tabs.

    The handler is installed on the shared QWebEngineProfile so every tab
    can reach it.  Responses are plain JSON.
    """

    def __init__(self, parent=None):
        super().__init__(parent)
        self._dict = get_dict_module()

    def requestStarted(self, job: QWebEngineUrlRequestJob) -> None:
        url = job.requestUrl()

        if url.path() != '/lookup':
            job.fail(QWebEngineUrlRequestJob.Error.UrlNotFound)
            return

        params = urllib.parse.parse_qs(url.query())
        text = params.get('text', [''])[0]

        if not text:
            result = {'matched': None, 'entries': []}
        elif not self._dict.is_available:
            result = {
                'error': (
                    'Dictionary not installed. '
                    'Run  scripts/build_jitendex.py  to set it up.'
                ),
                'matched': None,
                'entries': [],
            }
        else:
            result = self._dict.lookup_text(text)

        data = json.dumps(result, ensure_ascii=False).encode('utf-8')

        # QBuffer must stay alive until the job finishes reading it.
        # Parenting it to `self` keeps it from being GC'd; job.destroyed
        # cleans it up once Qt is done with the request.
        buf = QBuffer(self)
        buf.setData(QByteArray(data))
        buf.open(QBuffer.OpenModeFlag.ReadOnly)
        job.reply(b'application/json', buf)
        job.destroyed.connect(buf.deleteLater)
