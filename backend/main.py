############################################################
#  [*] Reorg Backend — entrypoint
#
#  The Flask app behind the 51% attack teaching tool. There
#  is a single feature here, so this file is thin: run
#  directly (python main.py) it wires the database schema,
#  the one reorg-attack blueprint and the dev server.
#
#  The reorg RPC settings are NOT loaded here — they live
#  beside the routes (REORG_ATTACK_CONFIG in
#  app/reorg_attack/routes.py, the docker service names of
#  the two fullnodes on the stack's internal network).
#
#  Used by:
#    - Dockerfile — CMD ["python3", "-u", "main.py"]
############################################################


import os

from flask import Flask
from werkzeug.middleware.proxy_fix import ProxyFix


# The Flask app — the reorg blueprint registers its routes
# onto it in the __main__ block below.
app = Flask(__name__)








############################################################
# Entrypoint
############################################################
#
# Wires the whole backend when run directly: the database
# schema, then the reorg-attack blueprint, then the dev
# server. Importing the blueprint builds routes.py's shared
# ReorgAttackManager (it only opens RPC clients — no network
# call until a route runs), so the import is safe to defer to
# here beside the rest of the startup.
############################################################

if __name__ == '__main__':
    APP_DEBUG = os.getenv('APP_DEBUG', 'false').lower() == 'true'



    # STEP 1: the SQLite schema (idempotent).
    # =======================================
    from app.database.db_init import init_db
    init_db()



    # STEP 2: ProxyFix for correct IP address detection.
    # ==================================================
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_prefix=1)



    # STEP 3: Blueprints
    # ==================
    from app.reorg_attack.routes import bp_reorg_attack
    app.register_blueprint(bp_reorg_attack, url_prefix='')



    # STEP 4: Run the server
    # ======================
    app.run(host='0.0.0.0', port=8000, debug=APP_DEBUG)
