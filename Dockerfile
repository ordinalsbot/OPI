FROM rust:1.70.0-bullseye AS builder

WORKDIR /ord

# Copy the ord source code
COPY ord .

RUN cargo build --release

FROM node:20.11-bullseye-slim

WORKDIR /app

# Install python and the python deps
RUN apt update && apt install -y python3-pip postgresql-client procps pbzip2 vim \
    && python3 -m pip install python-dotenv \
    && python3 -m pip install psycopg2-binary \
    && python3 -m pip install json5 \
    && python3 -m pip install stdiomask \
    && python3 -m pip install requests \
    && python3 -m pip install boto3 \
    && python3 -m pip install tqdm

COPY . .

# Install node deps
RUN cd modules/main_index && npm install \
    && cd ../brc20_api && npm install \
    && cd ../bitmap_api && npm install \
    && cd ../sns_api && npm install

# Bundle ord binary
COPY --from=builder /ord/target/release/ord /bin/ord

