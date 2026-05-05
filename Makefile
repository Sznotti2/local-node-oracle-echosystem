# Reads .mode file to decide which compose file to use.
# Run "make don" or "make single" once to switch, then use normal targets.

MODE_FILE := .mode
# If .mode doesn't exist yet, default to single-node
MODE := $(shell cat $(MODE_FILE) 2>/dev/null || echo single)

# Expand to the right compose command based on the stored mode
COMPOSE = docker compose $(if $(filter don,$(MODE)),-f docker-compose-don.yml)
DEPLOY = $(if $(filter don,$(MODE)),contracts-deploy-don,contracts-deploy)

# Declare all targets as phony so Make doesn't confuse them with filenames
.PHONY: up start down clean restart full-restart restart-service logs logs-deploy help


single:
	@echo "single" > $(MODE_FILE)
	@echo "Mode set to: single-node"

don:
	@echo "don" > $(MODE_FILE)
	@echo "Mode set to: DON (5-node)"


help:
	@echo "Current mode: $(MODE)"
	@echo ""
	@echo "  make single          Switch to single-node mode (persists until changed)"
	@echo "  make don             Switch to DON 5-node mode (persists until changed)"
	@echo ""
	@echo "  make up              Build images and start the system"
	@echo "  make start           Start using cached images (faster)"
	@echo "  make down            Stop containers, preserve volumes"
	@echo "  make clean           Stop containers and delete all volumes"
	@echo "  make restart         Bounce containers without re-running deploy"
	@echo "  make full-restart    Teardown and reinitialise"
	@echo "  make restart-service SERVICE=chainlink-3"
	@echo "  make logs            Follow live logs"
	@echo "  make logs-deploy     Review the completed deploy output"

up:
	@echo "Starting in [$(MODE)] mode..."
	$(COMPOSE) up -d --build
	$(COMPOSE) wait $(DEPLOY)
	@echo "System ready."

start:
	$(COMPOSE) up -d
	$(COMPOSE) wait $(DEPLOY)
	@echo "System ready."

down:
	$(COMPOSE) down

# also deletes the Postgres database and Chainlink node state
clean:
	$(COMPOSE) down -v
	@echo "All containers and volumes removed."

restart:
	$(COMPOSE) restart
	@echo "All containers restarted."

full-restart:
	$(MAKE) down
	$(MAKE) start
	@echo "All containers restarted."

# Usage: make restart-service SERVICE=chainlink
restart-service:
	$(COMPOSE) restart $(SERVICE)
	@echo "Service restarted."

logs:
	$(COMPOSE) logs -f

logs-deploy:
	$(COMPOSE) logs $(DEPLOY)

