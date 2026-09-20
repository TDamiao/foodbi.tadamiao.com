#!/bin/zsh
set -e

cd "$(dirname "$0")"

echo "FoodBI ETL - carga completa"
echo

if [ ! -x ".venv/bin/python" ]; then
  echo "Ambiente Python nao encontrado. Criando .venv..."
  if ! python3 -m venv .venv; then
    echo "ERRO: nao foi possivel criar o ambiente virtual. Instale o Python 3.11 ou superior."
    echo
    read "dummy?Pressione ENTER para fechar..."
    exit 1
  fi

  echo "Instalando dependencias do ETL..."
  if ! .venv/bin/pip install -e .; then
    echo "ERRO: nao foi possivel instalar as dependencias do ETL."
    echo
    read "dummy?Pressione ENTER para fechar..."
    exit 1
  fi
fi

if [ ! -f ".env" ]; then
  if [ ! -f ".env.example" ]; then
    echo "ERRO: arquivo .env.example nao encontrado."
    echo
    read "dummy?Pressione ENTER para fechar..."
    exit 1
  fi
  cp .env.example .env
  echo "Arquivo .env criado a partir de .env.example."
fi

echo
read -s "mysql_password?Digite a senha do MySQL (nao sera exibida): "
echo

if [ -z "$mysql_password" ]; then
  echo "ERRO: a senha do MySQL nao pode ficar vazia."
  echo
  read "dummy?Pressione ENTER para fechar..."
  exit 1
fi

if ! printf '%s' "$mysql_password" | .venv/bin/python -c '
from pathlib import Path
import sys

path = Path(".env")
password = sys.stdin.read()
lines = path.read_text(encoding="utf-8").splitlines()
updated = False

for index, line in enumerate(lines):
    if line.startswith("MYSQL_PASSWORD="):
        lines[index] = f"MYSQL_PASSWORD={password}"
        updated = True
        break

if not updated:
    lines.append(f"MYSQL_PASSWORD={password}")

path.write_text("\n".join(lines) + "\n", encoding="utf-8")
'; then
  echo "ERRO: nao foi possivel atualizar MYSQL_PASSWORD no .env."
  unset mysql_password
  echo
  read "dummy?Pressione ENTER para fechar..."
  exit 1
fi
unset mysql_password
echo "MYSQL_PASSWORD atualizado no .env local."

if [ ! -d "downloads" ]; then
  echo "ERRO: pasta downloads nao encontrada."
  echo
  read "dummy?Pressione ENTER para fechar..."
  exit 1
fi

echo "Pastas encontradas em downloads:"
find downloads -mindepth 1 -maxdepth 1 -type d -exec basename {} \; | sort
echo

read "competencia?Digite a pasta da competencia, exemplo 2026-07: "
competencia="${competencia// /}"

if [ -z "$competencia" ]; then
  echo "ERRO: nenhuma pasta informada."
  echo
  read "dummy?Pressione ENTER para fechar..."
  exit 1
fi

local_dir="downloads/$competencia"

if [ ! -d "$local_dir" ]; then
  echo "ERRO: pasta nao encontrada: $local_dir"
  echo "Crie essa pasta e coloque nela o ZIP da Receita, por exemplo:"
  echo "  $local_dir/$competencia.zip"
  echo
  read "dummy?Pressione ENTER para fechar..."
  exit 1
fi

zip_count=$(find "$local_dir" -maxdepth 1 -type f -name "*.zip" | wc -l | tr -d " ")
if [ "$zip_count" = "0" ]; then
  echo "ERRO: nenhum arquivo .zip encontrado em $local_dir"
  echo
  read "dummy?Pressione ENTER para fechar..."
  exit 1
fi

echo
echo "A carga completa sera executada usando: $local_dir"
echo "Isso vai gravar no MySQL configurado no arquivo .env."
echo
read "confirmacao?Continuar? Digite SIM para confirmar: "

if [ "$confirmacao" != "SIM" ]; then
  echo "Carga cancelada."
  echo
  read "dummy?Pressione ENTER para fechar..."
  exit 0
fi

echo
echo "Iniciando carga completa..."
echo

.venv/bin/python -m foodbi_etl full-load --local-dir "$local_dir"

echo
echo "Atualizando coordenadas das cidades..."
coords_csv="/tmp/foodbi-municipios.csv"
coords_url="https://raw.githubusercontent.com/kelvins/Municipios-Brasileiros/main/csv/municipios.csv"

if curl -L -o "$coords_csv" "$coords_url"; then
  .venv/bin/python -m foodbi_etl import-coords "$coords_csv"
else
  echo
  echo "AVISO: carga concluida, mas nao foi possivel baixar o CSV de coordenadas."
  echo "Para atualizar manualmente depois, rode:"
  echo "  curl -L -o /tmp/foodbi-municipios.csv $coords_url"
  echo "  .venv/bin/python -m foodbi_etl import-coords /tmp/foodbi-municipios.csv"
fi

echo
echo "Carga finalizada."
read "dummy?Pressione ENTER para fechar..."
