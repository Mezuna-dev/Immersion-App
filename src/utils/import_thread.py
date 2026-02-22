from PyQt6.QtCore import QThread, pyqtSignal
import anki_importer


class ImportThread(QThread):
    finished = pyqtSignal()
    error = pyqtSignal(str)

    def __init__(self, apkg_path):
        super().__init__()
        self.apkg_path = apkg_path

    def run(self):
        try:
            anki_importer.import_anki_deck(self.apkg_path)
            self.finished.emit()
        except Exception as e:
            self.error.emit(str(e))