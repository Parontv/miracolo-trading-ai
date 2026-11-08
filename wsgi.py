"""Production WSGI entrypoint for Gunicorn."""
from miracolo_trading.http_api import create_app

application = create_app()
