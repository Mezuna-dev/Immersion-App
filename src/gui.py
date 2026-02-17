from PyQt6.QtWidgets import QApplication, QMainWindow, QWidget, QVBoxLayout, QLabel, QPushButton, QStackedWidget
from PyQt6.QtCore import Qt
import sys

class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()

        self.setWindowTitle("Immersion Suite")

        self.setGeometry(100, 100, 800, 600)

        self.stacked_widget = QStackedWidget()
        self.dashboard_widget = QWidget()

        self.stacked_widget.addWidget(self.dashboard_widget)

        self.setCentralWidget(self.stacked_widget)



def main():
    app = QApplication(sys.argv)

    window = MainWindow()

    window.show()

    app.exec()



if __name__ == "__main__":
    main()