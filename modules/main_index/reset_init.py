# pip install python-dotenv
# pip install psycopg2-binary
# pip install stdiomask

import os, psycopg2, pathlib, stdiomask
from dotenv import load_dotenv

load_dotenv()
db_user = os.getenv("DB_USER") or "postgres"
db_host = os.getenv("DB_HOST") or "localhost"
db_port = int(os.getenv("DB_PORT") or "5432")
db_database = os.getenv("DB_DATABASE") or "postgres"
db_password = os.getenv("DB_PASSWD")

network_type = os.getenv("NETWORK_TYPE") or "mainnet"

## connect to db
conn = psycopg2.connect(
  host=db_host,
  port=db_port,
  database=db_database,
  user=db_user,
  password=db_password)
conn.autocommit = True
cur = conn.cursor()

db_exists = False
try:
  cur.execute('select count(*) from block_hashes;')
  hash_cnt = cur.fetchone()[0]
  if hash_cnt > 0:
    db_exists = True
except:
  pass

if db_exists:
  res = input("It seems like you have entries on DB, are you sure to reset databases? This WILL RESET indexing progress. (y/n) ")
  if res != 'y':
    print('aborting')
    exit(1)

## reset db
sqls = open('db_reset.sql', 'r').read().split(';')
for sql in sqls:
  if sql.strip() != '':
    cur.execute(sql)

sqls = open('db_init.sql', 'r').read().split(';')
for sql in sqls:
  if sql.strip() != '':
    cur.execute(sql)

cur.execute('INSERT INTO ord_network_type (network_type) VALUES (%s);', (network_type,))

## close db
cur.close()
conn.close()

ord_folder = os.getenv("ORD_FOLDER") or "../../ord/target/release/"
ord_datadir = os.getenv("ORD_DATADIR") or "."

ord_folder = pathlib.Path(ord_folder).absolute()
ord_datadir = pathlib.Path(ord_folder, ord_datadir).absolute()

network_path = ""
if network_type == "mainnet":
  network_path = ""
elif network_type == "testnet":
  network_path = "testnet3"
elif network_type == "signet":
  network_path = "signet"
elif network_type == "regtest":
  network_path = "regtest"

ord_index_redb_path = pathlib.Path(ord_datadir, network_path, "index.redb").absolute()
ord_index_redb_path.unlink(missing_ok=True)

if not pathlib.Path(ord_folder, network_path).exists():
  pathlib.Path(ord_folder, network_path).mkdir(parents=True)

ord_log_file_path = pathlib.Path(ord_folder, network_path, "log_file.txt").absolute()
ord_log_file_path.write_text("")

ord_log_file_index_path = pathlib.Path(ord_folder, network_path, "log_file_index.txt").absolute()
ord_log_file_index_path.write_text("")

log_file_error_path = pathlib.Path("log_file_error.txt").absolute()
log_file_error_path.write_text("")

print('done')
