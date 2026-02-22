from PyQt6.QtWidgets import QWidget, QVBoxLayout
from PyQt6.QtCore import pyqtSignal, Qt, QObject, pyqtSlot, QUrl
from PyQt6.QtWebEngineWidgets import QWebEngineView
from PyQt6.QtWebChannel import QWebChannel
from pathlib import Path
import database


class DashboardBridge(QObject):
    def __init__(self, parent_widget):
        super().__init__()
        self.parent_widget = parent_widget

    @pyqtSlot()
    def showSRS(self):
        self.parent_widget.show_srs_signal.emit()


class DashboardWidget(QWidget):
    show_srs_signal = pyqtSignal()
    
    def __init__(self):
        super().__init__()
        self.init_ui()
    
    def init_ui(self):
        layout = QVBoxLayout()
        
        self.web_view = QWebEngineView()
        self.bridge = DashboardBridge(self)
        self.channel = QWebChannel()
        self.channel.registerObject("bridge", self.bridge)
        self.web_view.page().setWebChannel(self.channel)
        
        self.update_stats()
        
        layout.addWidget(self.web_view)
        self.setLayout(layout)
    
    def update_stats(self):
        due_cards = database.get_due_cards()
        new_cards = database.get_new_cards(limit=20)

        page_path = Path(__file__).parent.parent.parent / "web" / "pages" / "dashboard.html"
        with open(page_path, "r") as f:
            html = f.read()

        html = html.replace("{{due_cards}}", str(len(due_cards)))
        html = html.replace("{{new_cards}}", str(len(new_cards)))

        temp_path = Path(__file__).parent.parent.parent / 'web' / 'pages' / 'dashboard_temp.html'
        with open(temp_path, 'w') as f:
            f.write(html)
        
        self.web_view.setUrl(QUrl.fromLocalFile(str(temp_path.absolute())))
    
    def keyPressEvent(self, event):
        if event.key() == Qt.Key.Key_F5:
            self.update_stats()