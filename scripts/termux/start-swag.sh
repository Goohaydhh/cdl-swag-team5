#!/usr/bin/env bash
# Relance SWAG sur une tablette Android (Termux).
# Ne relance que ce qui est arrete, puis teste la sante de l'API.
# Suppose que le depot est clone dans ~/swag (voir le guide d'installation).

termux-wake-lock

PGDATA=$PREFIX/var/lib/postgresql
if ! pg_ctl -D $PGDATA status >/dev/null 2>&1; then
  # verrou laisse par un arret brutal de Termux : sans ca, PostgreSQL refuse de demarrer
  rm -f $PGDATA/postmaster.pid $PREFIX/tmp/.s.PGSQL.5432.lock
  pg_ctl -D $PGDATA -l ~/pg.log start
fi

redis-cli ping >/dev/null 2>&1 || redis-server --daemonize yes

if ! pgrep -f "node dist/main.js" >/dev/null; then
  # setsid nohup : l'API survit a la fin de la session SSH et aux coupures de Termux
  cd ~/swag/apps/api && setsid nohup node dist/main.js > ~/api.log 2>&1 < /dev/null &
fi

sleep 15; curl -s http://127.0.0.1:3100/v1/health; echo
