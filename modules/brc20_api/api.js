require('dotenv').config();
var express = require('express');
const { Pool } = require('pg')
var cors = require('cors')
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');

// for self-signed cert of postgres
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const EVENT_SEPARATOR = "|";

var db_pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_DATABASE || 'postgres',
  password: process.env.DB_PASSWD,
  port: parseInt(process.env.DB_PORT || "5432"),
  max: process.env.DB_MAX_CONNECTIONS || 10, // maximum number of clients!!
  ssl: process.env.DB_SSL == 'true' ? true : false
})

var use_extra_tables = process.env.USE_EXTRA_TABLES == 'true' ? true : false

const api_port = parseInt(process.env.API_PORT || "8000")
const api_host = process.env.API_HOST || '127.0.0.1'

const rate_limit_enabled = process.env.RATE_LIMIT_ENABLE || 'false'
const rate_limit_window_ms = process.env.RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000
const rate_limit_max = process.env.RATE_LIMIT_MAX || 100

var app = express();
app.set('trust proxy', parseInt(process.env.API_TRUSTED_PROXY_CNT || "0"))

var corsOptions = {
  origin: '*',
  optionsSuccessStatus: 200 // some legacy browsers (IE11, various SmartTVs) choke on 204
}
app.use([cors(corsOptions)])

if (rate_limit_enabled === 'true') {
  const limiter = rateLimit({
    windowMs: rate_limit_window_ms,
    max: rate_limit_max,
    standardHeaders: true,
    legacyHeaders: false,
  })
  // Apply the delay middleware to all requests.
  app.use(limiter);
}

app.get('/v1/brc20/ip', (request, response) => response.send(request.ip))

async function query_db(query, params = []) {
  return await db_pool.query(query, params)
}

app.get('/v1/brc20/db_version', async (request, response) => {
  try {
    console.log(`${request.protocol}://${request.get('host')}${request.originalUrl}`)
    let res = await query_db('SELECT db_version FROM brc20_indexer_version;')
    response.send(res.rows[0].db_version + '')
  } catch (err) {
    console.log(err)
    response.status(500).send({ error: 'internal error', result: null })
  }
})

// OB additions
app.get('/v1/brc20/ticker_info', async (request, response) => {
  try {
    console.log(`${request.protocol}://${request.get('host')}${request.originalUrl}`)
    if (!request.query.ticker) {
      return response.status(400).send({ error: 'ticker is required', result: null })
    }
    let tick = request.query.ticker.toLowerCase() || ''
    let query = ` select *
                  from brc20_tickers
                  where tick = $1;`
    let params = [tick]

    let res = await query_db(query, params)
    if (res.rows.length == 0) {
      response.status(400).send({ error: 'no ticker found', result: null })
      return
    }
    response.send({ error: null, result: res.rows[0] })
  } catch (err) {
    console.log(err)
    response.status(500).send({ error: 'internal error', result: null })
  }
});

app.get('/v1/brc20/event_hash_version', async (request, response) => {
  try {
    console.log(`${request.protocol}://${request.get('host')}${request.originalUrl}`)
    let res = await query_db('SELECT event_hash_version FROM brc20_indexer_version;')
    response.send(res.rows[0].event_hash_version + '')
  } catch (err) {
    console.log(err)
    response.status(500).send({ error: 'internal error', result: null })
  }
})

async function get_block_height_of_db() {
  try {
    let res = await query_db('SELECT max(block_height) as max_block_height FROM brc20_block_hashes;')
    return res.rows[0].max_block_height
  } catch (err) {
    console.log(err)
    return -1
  }
}

app.get('/v1/brc20/block_height', async (request, response) => {
  try {
    console.log(`${request.protocol}://${request.get('host')}${request.originalUrl}`)
    let block_height = await get_block_height_of_db()
    response.send(block_height + '')
  } catch (err) {
    console.log(err)
    response.status(500).send({ error: 'internal error', result: null })
  }
})

// get a given ticker balance of a given pkscript at the start of a given block height
app.get('/v1/brc20/balance_on_block', async (request, response) => {
  try {
    console.log(`${request.protocol}://${request.get('host')}${request.originalUrl}`)
    let block_height = request.query.block_height
    let address = request.query.address || null
    let pkscript = request.query.pkscript || null
    if (!block_height) {
      return response.status(400).send({ error: 'block_height is required', result: null })
    }
    if (!request.query.ticker) {
      return response.status(400).send({ error: 'ticker is required', result: null })
    }
    let tick = request.query.ticker.toLowerCase()

    let current_block_height = await get_block_height_of_db()
    if (block_height > current_block_height + 1) {
      response.status(400).send({ error: 'block not indexed yet', result: null })
      return
    }

    let query =  `select distinct on (${pkscript ? 'pkscript' : 'wallet'}) 
      overall_balance, available_balance, pkscript, wallet
      from brc20_historic_balances
      where block_height <= $1
        and (${pkscript ? 'pkscript' : 'wallet'} = $2 or $2 is null)
        and tick = $3
      order by ${pkscript ? 'pkscript' : 'wallet'}, block_height desc, id DESC;`
    let params = [block_height, pkscript || address, tick];
    let res = await query_db(query, params)
    if (res.rows.length == 0) {
      response.status(400).send({ error: 'no balance found', result: null })
      return
    }

    let rows = res.rows
    // order rows using parseInt(overall_balance) desc
    rows.sort((a, b) => parseInt(b.overall_balance) - parseInt(a.overall_balance))
    // remove rows with parseInt(overall_balance) == 0
    rows = rows.filter((row) => parseInt(row.overall_balance) != 0)

    response.send({ error: null, result: rows })
  } catch (err) {
    console.log(err)
    response.status(500).send({ error: 'internal error', result: null })
  }
});

// get all brc20 activity of a given block height
app.get('/v1/brc20/activity_on_block', async (request, response) => {
  try {
    console.log(`${request.protocol}://${request.get('host')}${request.originalUrl}`)
    let block_height = request.query.block_height

    let current_block_height = await get_block_height_of_db()
    if (block_height > current_block_height) {
      response.status(400).send({ error: 'block not indexed yet', result: null })
      return
    }

    let res1 = await query_db('select event_type_name, event_type_id from brc20_event_types;')
    let event_type_id_to_name = {}
    res1.rows.forEach((row) => {
      event_type_id_to_name[row.event_type_id] = row.event_type_name
    })

    let query =  `select event, event_type, inscription_id
                  from brc20_events
                  where block_height = $1
                  order by id asc;`
    let res = await query_db(query, [block_height])
    let result = []
    for (const row of res.rows) {
      let event = row.event
      let event_type = event_type_id_to_name[row.event_type]
      let inscription_id = row.inscription_id
      event.event_type = event_type
      event.inscription_id = inscription_id
      result.push(event)
    }
    response.send({ error: null, result: result })
  } catch (err) {
    console.log(err)
    response.status(500).send({ error: 'internal error', result: null })
  }
});


app.get('/v1/brc20/get_current_balance_of_wallet', async (request, response) => {
  try {
    console.log(`${request.protocol}://${request.get('host')}${request.originalUrl}`)
    let address = request.query.address || ''
    let pkscript = request.query.pkscript || ''
    let tick = request.query.ticker?.toLowerCase() || ''
    if (!address && !pkscript && !tick) {
      return response.status(400).send({ error: 'address or pkscript is required', result: null })
    }

    let current_block_height = await get_block_height_of_db()
    let balance = null
    if (!use_extra_tables) {
      let query = ` select overall_balance, available_balance
                    from brc20_historic_balances
                    where pkscript = $1
                    and tick = $2
                    order by id desc
                    ;`
      let params = [pkscript, tick]
      if (address != '') {
        query = query.replace('pkscript', 'wallet')
        params = [address, tick]
      }
      if (!tick) {
        query = query.replace('and tick = $2', '')
        params = [address || pkscript]
      }

      let res = await query_db(query, params)
      if (res.rows.length == 0) {
        response.status(400).send({ error: 'no balance found', result: null })
        return
      }
      balance = res.rows[0]
    } else {
      let query = ` select overall_balance, available_balance, block_height, tick
                    from brc20_current_balances
                    where pkscript = $1
                      and tick = $2
                    ;`
      let params = [pkscript, tick]
      if (address != '') {
        query = query.replace('pkscript', 'wallet')
        params = [address, tick]
      }
      if (!tick) {
        query = query.replace('and tick = $2', '')
        params = [address || pkscript]
      }

      let res = await query_db(query, params)
      if (res.rows.length == 0) {
        response.status(400).send({ error: 'no balance found', result: null })
        return
      }
      balance = res.rows
    }
    // add block_height to each row inside balance
    balance = balance.map((row) => {
      row.block_height = current_block_height
      return row
    })
    response.send({ error: null, result: balance })
  } catch (err) {
    console.log(err)
    response.status(500).send({ error: 'internal error', result: null })
  }
});

app.get('/v1/brc20/get_valid_tx_notes_of_wallet', async (request, response) => {
  try {
    console.log(`${request.protocol}://${request.get('host')}${request.originalUrl}`)
    if (!use_extra_tables) {
      response.status(400).send({ error: 'not supported', result: null })
      return
    }

    let address = request.query.address || ''
    let pkscript = request.query.pkscript || ''

    let current_block_height = await get_block_height_of_db()
    let query = ` select tick, inscription_id, amount, block_height as genesis_height
                  from brc20_unused_tx_inscrs
                  where current_holder_pkscript = $1
                  order by tick asc;`
    let params = [pkscript]
    if (address != '') {
      query = query.replace('pkscript', 'wallet')
      params = [address]
    }

    let res = await query_db(query, params)
    if (res.rows.length == 0) {
      response.status(400).send({ error: 'no unused tx found', result: null })
      return
    }
    let result = {
      unused_txes: res.rows,
      block_height: current_block_height
    }

    response.send({ error: null, result: result })
  } catch (err) {
    console.log(err)
    response.status(500).send({ error: 'internal error', result: null })
  }
});

app.get('/v1/brc20/get_valid_tx_notes_of_ticker', async (request, response) => {
  try {
    console.log(`${request.protocol}://${request.get('host')}${request.originalUrl}`)
    if (!use_extra_tables) {
      response.status(400).send({ error: 'not supported', result: null })
      return
    }

    let tick = request.query.ticker.toLowerCase() || ''

    let current_block_height = await get_block_height_of_db()
    let query = ` select current_holder_pkscript, current_holder_wallet, inscription_id, amount, block_height as genesis_height
                  from brc20_unused_tx_inscrs
                  where tick = $1
                  order by current_holder_pkscript asc;`
    let params = [tick]

    let res = await query_db(query, params)
    if (res.rows.length == 0) {
      response.status(400).send({ error: 'no unused tx found', result: null })
      return
    }
    let result = {
      unused_txes: res.rows,
      block_height: current_block_height
    }

    response.send({ error: null, result: result })
  } catch (err) {
    console.log(err)
    response.status(500).send({ error: 'internal error', result: null })
  }
});

app.get('/v1/brc20/holders', async (request, response) => {
  try {
    console.log(`${request.protocol}://${request.get('host')}${request.originalUrl}`)
    if (!use_extra_tables) {
      response.status(400).send({ error: 'not supported', result: null })
      return
    }

    let tick = request.query.ticker.toLowerCase() || ''

    let current_block_height = await get_block_height_of_db()
    let query = ` select pkscript, wallet, overall_balance, available_balance
                  from brc20_current_balances
                  where tick = $1
                  order by overall_balance asc;`
    let params = [tick]

    let res = await query_db(query, params)
    if (res.rows.length == 0) {
      response.status(400).send({ error: 'no unused tx found', result: null })
      return
    }
    let rows = res.rows
    // order rows using parseInt(overall_balance) desc
    rows.sort((a, b) => parseInt(b.overall_balance) - parseInt(a.overall_balance))
    // remove rows with parseInt(overall_balance) == 0
    rows = rows.filter((row) => parseInt(row.overall_balance) != 0)
    let result = {
      unused_txes: rows,
      block_height: current_block_height
    }

    response.send({ error: null, result: result })
  } catch (err) {
    console.log(err)
    response.status(500).send({ error: 'internal error', result: null })
  }
});



app.get('/v1/brc20/get_hash_of_all_activity', async (request, response) => {
  try {
    console.log(`${request.protocol}://${request.get('host')}${request.originalUrl}`)
    let block_height = request.query.block_height
  
    let current_block_height = await get_block_height_of_db()
    if (block_height > current_block_height) {
      response.status(400).send({ error: 'block not indexed yet', result: null })
      return
    }

    let query =  `select cumulative_event_hash, block_event_hash
                  from brc20_cumulative_event_hashes
                  where block_height = $1;`
    let res = await query_db(query, [block_height])
    let cumulative_event_hash = res.rows[0].cumulative_event_hash
    let block_event_hash = res.rows[0].block_event_hash
  
    let res2 = await query_db('select indexer_version from brc20_indexer_version;')
    let indexer_version = res2.rows[0].indexer_version
  
    response.send({ error: null, result: {
        cumulative_event_hash: cumulative_event_hash,
        block_event_hash: block_event_hash,
        indexer_version: indexer_version,
        block_height: block_height
      } 
    })
  } catch (err) {
    console.log(err)
    response.status(500).send({ error: 'internal error', result: null })
  }
});

// NOTE: this may take a few minutes to run
app.get('/v1/brc20/get_hash_of_all_current_balances', async (request, response) => {
  try {
    console.log(`${request.protocol}://${request.get('host')}${request.originalUrl}`)
    let current_block_height = await get_block_height_of_db()
    let hash_hex = null
    if (!use_extra_tables) {
      let query = ` with tempp as (
                      select max(id) as id
                      from brc20_historic_balances
                      where block_height <= $1
                      group by pkscript, tick
                    )
                    select bhb.pkscript, bhb.tick, bhb.overall_balance, bhb.available_balance
                    from tempp t
                    left join brc20_historic_balances bhb on bhb.id = t.id
                    order by bhb.pkscript asc, bhb.tick asc;`
      let params = [current_block_height]

      let res = await query_db(query, params)
      res.rows.sort((a, b) => {
        if (a.pkscript < b.pkscript) {
          return -1
        } else if (a.pkscript > b.pkscript) {
          return 1
        } else {
          if (a.tick < b.tick) {
            return -1
          } else if (a.tick > b.tick) {
            return 1
          } else {
            return 0
          }
        }
      })
      let whole_str = ''
      res.rows.forEach((row) => {
        if (parseInt(row.overall_balance) != 0) {
          whole_str += row.pkscript + ';' + row.tick + ';' + row.overall_balance + ';' + row.available_balance + EVENT_SEPARATOR
        }
      })
      whole_str = whole_str.slice(0, -1)
      // get sha256 hash hex of the whole string
      const hash = crypto.createHash('sha256');
      hash.update(whole_str);
      hash_hex = hash.digest('hex');
    } else {
      let query = ` select pkscript, tick, overall_balance, available_balance
                    from brc20_current_balances
                    order by pkscript asc, tick asc;`
      let params = []

      let res = await query_db(query, params)
      res.rows.sort((a, b) => {
        if (a.pkscript < b.pkscript) {
          return -1
        } else if (a.pkscript > b.pkscript) {
          return 1
        } else {
          if (a.tick < b.tick) {
            return -1
          } else if (a.tick > b.tick) {
            return 1
          } else {
            return 0
          }
        }
      })
      let whole_str = ''
      res.rows.forEach((row) => {
        if (parseInt(row.overall_balance) != 0) {
          whole_str += row.pkscript + ';' + row.tick + ';' + row.overall_balance + ';' + row.available_balance + EVENT_SEPARATOR
        }
      })
      whole_str = whole_str.slice(0, -1)
      // get sha256 hash hex of the whole string
      const hash = crypto.createHash('sha256');
      hash.update(whole_str);
      hash_hex = hash.digest('hex');
    }

    let res2 = await query_db('select indexer_version from brc20_indexer_version;')
    let indexer_version = res2.rows[0].indexer_version

    response.send({ error: null, result: {
        current_balances_hash: hash_hex,
        indexer_version: indexer_version,
        block_height: current_block_height
      }
    })
  } catch (err) {
    console.log(err)
    response.status(500).send({ error: 'internal error', result: null })
  }
});

// get all events with a specific inscription id
app.get('/v1/brc20/event', async (request, response) => {
  try {
    console.log(`${request.protocol}://${request.get('host')}${request.originalUrl}`)

    let res1 = await query_db('select event_type_name, event_type_id from brc20_event_types;')
    let event_type_id_to_name = {}
    res1.rows.forEach((row) => {
      event_type_id_to_name[row.event_type_id] = row.event_type_name
    })

    let inscription_id = request.query.inscription_id;
    if(!inscription_id) {
      response.status(400).send({ error: 'inscription_id is required', result: null })
      return
    }

    let query =  `select event, event_type, inscription_id block_height
                  from brc20_events
                  where inscription_id = $1
                  order by id asc;`
    let res = await query_db(query, [inscription_id])
    let result = []
    for (const row of res.rows) {
      let event = row.event
      let event_type = event_type_id_to_name[row.event_type]
      let inscription_id = row.inscription_id
      event.event_type = event_type
      event.inscription_id = inscription_id
      result.push(event)
    }
    response.send({ error: null, result: result })
  } catch (err) {
    console.log(err)
    response.status(500).send({ error: 'internal error', result: null })
  }
});

// New endpoint to get all BRC-20 tokens with pagination and filtering
// there are no available tokens to mint
const MINT_STATUS_COMPLETED_TEXT = 'completed';
// less than 10% of the max supply remaining
const MINT_STATUS_NEARLY_FINISHED_TEXT = 'nearly_finished';
// most recently "deployed" tokens
const MINT_STATUS_NEWEST_MINT_TEXT = 'newest_deploy';
// whats in the mempool
// const MINT_STATUS_HOTTEST_TEXT = 'hottest';
// king of the hill~momentum - most minted in last 12 hours = 72 blocks + mempool
// const MINT_STATUS_MOMENTUM_MINT_TEXT = 'momentum';

// Percentage threshold of max supply below which a token is considered nearly finished (e.g. 0.1 means 10% remaining)
const MINT_FINISHED_THRESHOLD_PERCENTAGE = parseFloat(process.env.MINT_FINISHED_THRESHOLD_PERCENTAGE || '0.1');

// Number of recent blocks considered for marking a token as a "newest mint"
const NEWEST_MINT_BLOCKS = parseInt(process.env.NEWEST_MINT_BLOCKS || '100');

/**
 * GET /v1/brc20/tokens
 * Returns an array of all BRC-20 tokens with optional filtering, pagination, and event counts, sorted by descending holder count.
 *
 * Query Parameters:
 * @param {number} page - The page number for pagination (default: 1).
 * @param {number} limit - The number of results per page (default: 10).
 * @param {string} [ticker] - A keyword to filter tokens by their ticker (case-insensitive).
 * @param {string} [mint_status] - The mint status filter:
 *  - "completed": Tokens with no remaining supply.
 *  - "nearly finished": Tokens with less than 10% of supply remaining.
 *  - "newest mint": Tokens deployed in the most recent blocks.
 * @param {boolean} [include_events] - If true, includes the count of "mint-inscribe" events for each token.
 * @param {boolean} [include_mempool] - If true, includes the list of mempool events for each token.
 *
 * Response:
 * @returns {Object} JSON response with:
 *  - {number} total - Total number of tokens matching the filters.
 *  - {Array<Object>} result - The list of tokens, each containing:
 *    - {string} tick - The token ticker.
 *    - {number} max_supply - The maximum supply of the token.
 *    - {number} remaining_supply - The remaining tokens to be minted.
 *    - {number} limit_per_mint - Maximum tokens that can be minted per transaction.
 *    - {number} block_height - Block height at which the token was deployed.
 *    - {string} deploy_inscription_id - Unique ID of the token deployment.
 *    - {number} holders - Count of unique wallet holders.
 *    - {number} [mint_count] - (Optional) Count of "mint-inscribe" events.
 */
app.get('/v1/brc20/tokens', async (request, response) => {
  try {
    console.log(`${request.protocol}://${request.get('host')}${request.originalUrl}`);

    let { page, limit, ticker, mint_status, include_events, include_mempool } = request.query;
    
    page = parseInt(page) || 1;
    limit = parseInt(limit) || 10;
    let offset = (page - 1) * limit;
    include_events = include_events === 'true';

    let whereClauses = [];
    let params = [];

    // do not include tickers with length 5
    whereClauses.push("LENGTH(tick) < 5");
    // I'm convinced all is_self_mint=true is 5-byte tickers
    // confirmed with ddomo as well
    whereClauses.push("is_self_mint = false");

    // Use existing index `brc20_tickers_lower_tick_idx` for case-insensitive `ILIKE`
    if (ticker) {
      whereClauses.push("LOWER(tick) ILIKE $"+(params.length+1));
      params.push(`%${ticker}%`);
    }

    // Filter by mint status
    if (mint_status) {
      if (mint_status === MINT_STATUS_COMPLETED_TEXT) {
        whereClauses.push("remaining_supply = 0");
      } else if (mint_status === MINT_STATUS_NEARLY_FINISHED_TEXT) {
        whereClauses.push("remaining_supply / max_supply < $"+(params.length+1));
        params.push(MINT_FINISHED_THRESHOLD_PERCENTAGE);
        // do not include tokens with 0 remaining supply
        whereClauses.push("remaining_supply::numeric / max_supply > 0");
      } else if (mint_status === MINT_STATUS_NEWEST_MINT_TEXT) {
        whereClauses.push("block_height >= (SELECT MAX(block_height) - $"+(params.length+1)+" FROM brc20_tickers)");
        params.push(NEWEST_MINT_BLOCKS);
      }
      console.log("mint_status", mint_status);
      console.log("whereClauses", whereClauses);
      console.log("params", params);
    }

    let whereSQL = whereClauses.length > 0 ? "WHERE " + whereClauses.join(" AND ") : "";

    // Query to get total count for pagination
    let countQuery = `SELECT COUNT(*) AS total FROM brc20_tickers ${whereSQL};`;
    let countResult = await query_db(countQuery, params);
    let totalTokens = countResult.rows[0].total;

    // Query to get token data with pagination
    let dataQuery = `
      SELECT tick, max_supply, remaining_supply, limit_per_mint, block_height, deploy_inscription_id, is_self_mint, 
        (SELECT COUNT(DISTINCT wallet) FROM brc20_current_balances WHERE brc20_current_balances.tick = brc20_tickers.tick) AS holders
      FROM brc20_tickers
      ${whereSQL}
      ORDER BY holders DESC
      LIMIT $${params.length+1} OFFSET $${params.length+2};`;
    
    params.push(limit, offset);
    let dataResult = await query_db(dataQuery, params);
    let tokens = dataResult.rows;

    // If include_events=true, fetch the mint-inscribe count
    if (include_events && tokens.length > 0) {
      let tickersList = tokens.map(t => t.tick);
    
      let eventsQuery = `
        SELECT event->>'tick' AS tick, COUNT(*) AS mint_inscribes
        FROM brc20_events
        WHERE event_type = 1
          AND event->>'tick' = ANY($1)
        GROUP BY event->>'tick';
      `;
    
      let eventsResult = await query_db(eventsQuery, [tickersList]);
      let eventsMap = {};
      eventsResult.rows.forEach(row => {
        eventsMap[row.tick] = row.mint_inscribes;
      });
      tokens = tokens.map(t => ({
        ...t,
        mint_count: eventsMap[t.tick] || 0,
      }));
    } 

    // If include_mempool=true, fetch the mempool events from brc20_mempool_events at current blockheight
    if (include_mempool && tokens.length > 0) {
      let mempoolQuery = `
        SELECT *
        FROM brc20_mempool_events
        WHERE lower(event->>'tick') = ANY($1) AND block_height = $2
        ORDER BY seen_at DESC;
      `;
      const current_block_height = await get_block_height_of_db();
      let tickersList = tokens.map(t => t.tick);
      let mempoolResult = await query_db(mempoolQuery, [tickersList, current_block_height]);
      let mempoolMap = {};
      mempoolResult.rows.forEach(row => {
        // check event_type and increment deploy if 0, mint if 1
        let event = row.event;
        let event_type = row.event_type;
        let tick = event.tick.toLowerCase();
        if (event_type === 0) {
          mempoolMap[tick] = mempoolMap[tick] || { deploy: 0, mint: 0 };
          mempoolMap[tick].deploy++;
        } else if (event_type === 1) {
          mempoolMap[tick] = mempoolMap[tick] || { deploy: 0, mint: 0 };
          mempoolMap[tick].mint++;
        }
      });
      tokens = tokens.map(t => ({
        ...t,
        mempool_mint_count: mempoolMap[t.tick]?.mint || 0,
        mempool_deploy_count: mempoolMap[t.tick]?.deploy || 0,
      }));
    }

    response.send({
      error: null,
      total: totalTokens,
      result: tokens
    });

  } catch (err) {
    console.log(err);
    response.status(500).send({ error: 'internal error', result: null });
  }
});

// get all events with a specific inscription id
app.get('/v1/brc20/mempool_events', async (request, response) => {
  try {
    console.log(`${request.protocol}://${request.get('host')}${request.originalUrl}`)
    
    let tick = request.query.ticker?.toLowerCase() || '';

    let query;
    let params = [];
    
    if (tick) {
      query = `
        SELECT *
        FROM brc20_mempool_events
        WHERE lower(event->>'tick') = $1
        ORDER BY seen_at DESC;
      `;
      params.push(tick);
    } else {
      query = `
        SELECT *
        FROM brc20_mempool_events
        ORDER BY seen_at DESC;
      `;
    }
    
    let res = await query_db(query, params);

    response.send({ error: null, result: res.rows })
  } catch (err) {
    console.log(err)
    response.status(500).send({ error: 'internal error', result: null })
  }
});

app.listen(api_port, api_host);
