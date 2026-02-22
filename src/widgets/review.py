from PyQt6.QtWidgets import QWidget, QVBoxLayout
from PyQt6.QtCore import pyqtSignal, Qt, QObject, pyqtSlot, QUrl
from PyQt6.QtWebEngineWidgets import QWebEngineView
from PyQt6.QtWebChannel import QWebChannel
from pathlib import Path


class ReviewBridge(QObject):
    def __init__(self, parent_widget):
        super().__init__()
        self.parent_widget = parent_widget

    @pyqtSlot()
    def goToDashboard(self):
        self.parent_widget.go_to_dashboard_signal.emit()


class ReviewWidget(QWidget):
    go_to_dashboard_signal = pyqtSignal()
    
    def __init__(self):
        super().__init__()
        self.init_ui()
    
    def init_ui(self):
        layout = QVBoxLayout()
        
        self.web_view = QWebEngineView()
        self.bridge = ReviewBridge(self)
        self.channel = QWebChannel()
        self.channel.registerObject("bridge", self.bridge)
        self.web_view.page().setWebChannel(self.channel)
        
        self.load_page()
        
        layout.addWidget(self.web_view)
        self.setLayout(layout)
    
    def load_page(self):
        page_path = Path(__file__).parent.parent.parent / "web" / "pages" / "srs.html"
        self.web_view.setUrl(QUrl.fromLocalFile(str(page_path.absolute())))