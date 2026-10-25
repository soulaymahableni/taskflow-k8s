# TaskFlow – Application trois niveaux sur k3s (Mini-projet 2)

TaskFlow est un gestionnaire de tâches : page d'accueil, inscription/connexion, tableau de bord et CRUD des tâches.

| Niveau | Technologie | Image |
|---|---|---|
| Frontend | HTML/CSS/JS servi par nginx-unprivileged (port 8080) | hablani/taskflow-frontend:1.0.0 |
| API REST | Node.js 20 + Express (port 3000), /health et /ready | hablani/taskflow-api:1.0.0 |
| Base de données | PostgreSQL 16 | postgres:16-alpine |

Namespace : `taskapp` — URL : http://app.k3s.local

## Arborescence

    app/api/          code de l'API + Dockerfile
    app/frontend/     pages web + Dockerfile
    k8s/00-namespace/ namespace, ResourceQuota, LimitRange, ServiceAccounts
    k8s/10-config/    ConfigMaps, secret.example.yaml (le vrai secret n'est pas versionné)
    k8s/20-db/        Service headless, StatefulSet, sauvegarde (PVC + CronJob), pod de restauration
    k8s/30-app/       API (Deployment + Service), frontend (Deployment + Service), Ingress
    k8s/40-security/  RBAC dev-viewer, NetworkPolicies
    docker-compose.yml  test local (phase 0)

## Prérequis

- Cluster k3s (1 master + 2 workers) avec Traefik et la StorageClass local-path
- kubectl configuré
- Fichier hosts de Windows : `192.168.190.153   app.k3s.local`

## 1. Construire et publier les images

    docker build -t hablani/taskflow-api:1.0.0 app/api
    docker build -t hablani/taskflow-frontend:1.0.0 app/frontend
    docker push hablani/taskflow-api:1.0.0
    docker push hablani/taskflow-frontend:1.0.0

## 2. Créer le Secret (jamais versionné)

    kubectl create secret generic db-credentials -n taskapp \
      --from-literal=POSTGRES_USER=taskuser \
      --from-literal=POSTGRES_PASSWORD="$(openssl rand -base64 18)" \
      --from-literal=JWT_SECRET="$(openssl rand -hex 32)" \
      --dry-run=client -o yaml > k8s/10-config/secret.yaml

## 3. Ordre de déploiement

    kubectl apply -f k8s/00-namespace/
    kubectl label ns taskapp pod-security.kubernetes.io/enforce=baseline pod-security.kubernetes.io/warn=restricted --overwrite
    kubectl apply -f k8s/10-config/configmap.yaml -f k8s/10-config/secret.yaml
    kubectl apply -f k8s/20-db/01-service-headless.yaml -f k8s/20-db/02-statefulset.yaml -f k8s/20-db/03-backup.yaml
    kubectl -n taskapp rollout status statefulset/db
    kubectl apply -f k8s/30-app/
    kubectl -n taskapp rollout status deployment/api
    kubectl apply -f k8s/40-security/

Ne pas appliquer `secret.example.yaml` (fausses valeurs).

## 4. Sauvegarde

Le CronJob `db-backup` lance `pg_dump` toutes les 5 minutes vers `backup-pvc` et garde les 10 derniers dumps.
Sauvegarde immédiate :

    kubectl -n taskapp create job --from=cronjob/db-backup backup-manuel
    kubectl -n taskapp logs job/backup-manuel

## 5. Procédure de restauration

    kubectl apply -f k8s/20-db/04-restore-pod.yaml
    kubectl -n taskapp wait --for=condition=Ready pod/restore
    kubectl -n taskapp exec restore -- ls -lh /backup
    # remplacer dump-AAAAMMJJ-HHMM.sql par le fichier choisi (heure en UTC)
    kubectl -n taskapp exec restore -- sh -c 'psql -h db -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "DROP TABLE IF EXISTS tasks, users CASCADE;"'
    kubectl -n taskapp exec restore -- sh -c 'psql -h db -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f /backup/dump-AAAAMMJJ-HHMM.sql'
    kubectl -n taskapp delete pod restore

## 6. Vérifications de sécurité

    SA=system:serviceaccount:taskapp:dev-viewer
    kubectl auth can-i list pods   -n taskapp --as=$SA   # yes
    kubectl auth can-i delete pods -n taskapp --as=$SA   # no
    kubectl auth can-i get secrets -n taskapp --as=$SA   # no
    kubectl -n taskapp run np-test --restart=Never --image=postgres:16-alpine -- pg_isready -h db -t 5
    kubectl -n taskapp logs np-test    # db:5432 - no response (bloqué par NetworkPolicy)
    kubectl -n taskapp delete pod np-test
