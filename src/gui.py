from PyQt6.QtWidgets import QApplication, QMainWindow, QWidget, QVBoxLayout, \
QLabel, QStackedWidget, QFileDialog, QProgressDialog, QMessageBox
from PyQt6.QtCore import Qt, pyqtSignal, QThread, QObject, pyqtSlot
from PyQt6.QtWebEngineWidgets import QWebEngineView
from PyQt6.QtWebChannel import QWebChannel
from pathlib import Path
import sys
import database
import ankiimport

class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        database.initialize_database()

        self.setWindowTitle("Immersion Suite")

        self.showMaximized()
        self.menu_bar = self.menuBar()

        self.file_menu = self.menu_bar.addMenu("File")
        self.edit_menu = self.menu_bar.addMenu("Edit")
        self.view_menu = self.menu_bar.addMenu("View")
        self.help_menu = self.menu_bar.addMenu("Help")

        import_action = self.file_menu.addAction("Import Deck")
        exit_action = self.file_menu.addAction("Exit")

        import_action.triggered.connect(self.import_deck)
        exit_action.triggered.connect(self.close)

        self.stacked_widget = QStackedWidget()
        self.dashboard_widget = DashboardWidget()
        self.review_widget = ReviewWidget()

        self.stacked_widget.addWidget(self.dashboard_widget)
        self.stacked_widget.addWidget(self.review_widget)

        self.setCentralWidget(self.stacked_widget)

        self.dashboard_widget.start_review_signal.connect(self.show_review_screen)

    def show_review_screen(self):
        self.stacked_widget.setCurrentIndex(1)  # Switch to review screen
    
    def import_deck(self):
        apkg_path = QFileDialog.getOpenFileName(self, "Import Anki Deck", "", "Anki Decks (*.apkg)")[0]
        if apkg_path == "":
            return

        self.progress = QProgressDialog("Importing deck...", "Cancel", 0, 0, self)
        self.progress.setWindowTitle("Import progress")
        self.progress.setModal(True)
        self.progress.show()

        self.import_thread = ImportThread(apkg_path)
        self.import_thread.finished.connect(self.import_finished)
        self.import_thread.error.connect(self.import_error)
        self.import_thread.start()
    
    def import_finished(self):
        self.progress.close()
        self.dashboard_widget.update_stats()
        QMessageBox.information(self, "Import Complete", "Deck imported successfully!")
    
    def import_error(self, error_message):
        self.progress.close()
        QMessageBox.critical(self, "Import Error", f"An error occurred while importing the deck:\n{error_message}")

class ImportThread(QThread):
    finished = pyqtSignal()
    error = pyqtSignal(str)

    def __init__(self, apkg_path):
        super().__init__()
        self.apkg_path = apkg_path

    def run(self):
        try:
            ankiimport.import_anki_deck(self.apkg_path)
            self.finished.emit()
        except Exception as e:
            self.error.emit(str(e))


class DashboardWidget(QWidget):
    start_review_signal = pyqtSignal()
    
    def __init__(self):
        super().__init__()
        self.init_ui()
    
    def init_ui(self):
        layout = QVBoxLayout()
        
        # Create web view
        self.web_view = QWebEngineView()

        self.bridge = DashboardBridge(self)

        self.channel = QWebChannel()
        self.channel.registerObject("bridge", self.bridge)

        self.web_view.page().setWebChannel(self.channel)
        
        # Load initial HTML
        self.update_stats()
        
        layout.addWidget(self.web_view)
        self.setLayout(layout)
    
    def update_stats(self):
        due_cards = database.get_due_cards()
        new_cards = database.get_new_cards(limit=20)

        page_path = Path(__file__).parent.parent / "pages" / "dashboard.html"
        with open(page_path, "r") as f:
            html = f.read()


        html = html.replace("{{due_cards}}", str(len(due_cards)))
        html = html.replace("{{new_cards}}", str(len(new_cards)))

        
        self.web_view.setHtml(html)
    
    def keyPressEvent(self, event):
        if event.key() == Qt.Key.Key_F5:  # Press F5 to reload
            self.update_stats()

class DashboardBridge(QObject):
    def __init__(self, parent_widget):
        super().__init__()
        self.parent_widget = parent_widget

    @pyqtSlot()
    def startReview(self):
        self.parent_widget.start_review_signal.emit()
    
    @pyqtSlot()
    def browseDeck(self):
        # Placeholder for browse deck functionality
        QMessageBox.information(self.parent_widget, "Browse Deck", "This feature is not implemented yet.")

class ReviewWidget(QWidget):
    def __init__(self):
        super().__init__()

        self.init_ui()
    
    def init_ui(self):
        layout = QVBoxLayout()

        title_label = QLabel("Review Session")
        layout.addWidget(title_label)

        self.setLayout(layout)

def main():
    app = QApplication(sys.argv)

    window = MainWindow()

    window.show()

    app.exec()



if __name__ == "__main__":
    main()