from PyQt6.QtWidgets import QApplication, QMainWindow, QStackedWidget, \
    QFileDialog, QProgressDialog, QMessageBox
import sys
import database
from widgets.dashboard import DashboardWidget
from widgets.review import ReviewWidget
from utils.import_thread import ImportThread


class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        database.initialize_database()

        self.setWindowTitle("Immersion Suite")
        self.showMaximized()
        
        self.setup_menu()
        self.setup_widgets()

    def setup_menu(self):
        self.menu_bar = self.menuBar()
        self.file_menu = self.menu_bar.addMenu("File")
        self.edit_menu = self.menu_bar.addMenu("Edit")
        self.view_menu = self.menu_bar.addMenu("View")
        self.help_menu = self.menu_bar.addMenu("Help")

        import_action = self.file_menu.addAction("Import Deck")
        exit_action = self.file_menu.addAction("Exit")

        import_action.triggered.connect(self.import_deck)
        exit_action.triggered.connect(self.close)

    def setup_widgets(self):
        self.stacked_widget = QStackedWidget()
        
        self.dashboard_widget = DashboardWidget()
        self.review_widget = ReviewWidget()

        self.stacked_widget.addWidget(self.dashboard_widget)
        self.stacked_widget.addWidget(self.review_widget)

        self.setCentralWidget(self.stacked_widget)

        # Connect signals
        self.dashboard_widget.show_srs_signal.connect(self.show_srs_screen)
        self.review_widget.go_to_dashboard_signal.connect(self.show_dashboard_screen)

    def show_dashboard_screen(self):
        self.stacked_widget.setCurrentIndex(0)

    def show_srs_screen(self):
        self.stacked_widget.setCurrentIndex(1)
    
    def import_deck(self):
        apkg_path = QFileDialog.getOpenFileName(
            self, "Import Anki Deck", "", "Anki Decks (*.apkg)"
        )[0]
        
        if not apkg_path:
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
        QMessageBox.critical(
            self, "Import Error", 
            f"An error occurred while importing the deck:\n{error_message}"
        )


def main():
    app = QApplication(sys.argv)
    window = MainWindow()
    window.show()
    app.exec()


if __name__ == "__main__":
    main()