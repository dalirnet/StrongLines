const fs = require("fs");
const _ = require("lodash");
const chalk = require("chalk");
const tracer = require("tracer");
const moment = require("moment");
const inquirer = require("inquirer");
const ora = require("ora");
const ccxt = require("ccxt");

inquirer.registerPrompt(
  "autocomplete",
  require("inquirer-autocomplete-prompt")
);

let logger = tracer.console({
  transport(data) {
    fs.appendFileSync(".log", data.rawoutput + "\n");
  },
});

async function start() {
  const spinner = ora({
    hideCursor: false,
    spinner: {
      interval: 160,
      frames: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
    },
    interval: 160,
  });
  const { exchange: exchangeName } = await inquirer.prompt({
    type: "autocomplete",
    message: "Exchange :",
    name: "exchange",
    pageSize: 8,
    default: "Binance",
    source({}, input = null) {
      return Promise.resolve(
        _.map(
          _.filter(ccxt.exchanges, (exchange) =>
            _.includes(_.toLower(exchange), _.toLower(input))
          ),
          _.upperFirst
        )
      );
    },
    filter(value) {
      return _.toLower(value);
    },
  });
  spinner.start("Loading exchange");
  const exchangeInstance = new ccxt[exchangeName]({ enableRateLimit: true });
  exchangeInstance
    .loadMarkets()
    .then(() => {
      spinner.succeed("Loaded exchange");
      inquirer
        .prompt([
          {
            type: "autocomplete",
            message: "Symbol :",
            name: "symbol",
            pageSize: 8,
            source({}, input = null) {
              return Promise.resolve(
                _.filter(exchangeInstance.symbols, (symbol) =>
                  _.includes(_.toLower(symbol), _.toLower(input))
                )
              );
            },
          },
          {
            type: "autocomplete",
            message: "Timeframe :",
            name: "timeframe",
            pageSize: 8,
            source({}, input = null) {
              let timeframes = [];
              _.forEach(exchangeInstance.timeframes, (timeframe, key) => {
                if (_.includes(_.toLower(timeframe), _.toLower(input))) {
                  timeframes.push({ name: key, value: timeframe });
                }
              });
              return Promise.resolve(timeframes);
            },
          },
        ])
        .then(({ symbol, timeframe }) => {
          spinner.start("Loading price");
          exchangeInstance
            .fetchOHLCV(symbol, timeframe)
            .then((data) => {
              spinner.succeed(
                `Loaded ${chalk.green(data.length)} frame from ${chalk.green(
                  moment(_.get(_.first(data), 0, 0)).format(
                    "MM/DD/YYYY HH:mm:ss"
                  )
                )} to ${chalk.green(
                  moment(_.get(_.last(data), 0, 0)).format(
                    "MM/DD/YYYY HH:mm:ss"
                  )
                )}`
              );
              let totalVolume = 0;
              let minPrice = 0;
              let maxPrice = 0;
              _.forEach(data, ([time, open, high, low, close, volume]) => {
                totalVolume += _.round(volume);
                let min = _.min([open, high, low, close]);
                if (minPrice === 0 || minPrice > min) {
                  minPrice = min;
                }
                let max = _.max([open, high, low, close]);
                if (maxPrice < max) {
                  maxPrice = max;
                }
              });
              let table = {};
              let step = (maxPrice - minPrice) / 100;
              _.forEach(_.range(100), (index) => {
                table[index] = {
                  line: _.round(minPrice + (index * step + step / 2), 6),
                  hit: 0,
                  volume: 0,
                  score: 0,
                  weight: 0,
                };
              });
              _.forEach(data, ([time, open, high, low, close, volume]) => {
                let pos = {
                  open: _.round((open - minPrice) / step),
                  high: _.round((high - minPrice) / step),
                  low: _.round((low - minPrice) / step),
                  close: _.round((close - minPrice) / step),
                };
                if (pos.open > 0) {
                  table[pos.open - 1].hit += 3;
                  table[pos.open - 1].volume += _.round(volume);
                }
                if (pos.high > 0) {
                  table[pos.high - 1].hit += 1;
                  table[pos.high - 1].volume += _.round(volume / 3);
                }
                if (pos.low > 0) {
                  table[pos.low - 1].hit += 1;
                  table[pos.low - 1].volume += _.round(volume / 3);
                }
                if (pos.close > 0) {
                  table[pos.close - 1].hit += 3;
                  table[pos.close - 1].volume += _.round(volume);
                }
              });
              let topScore = 0;
              _.forEach(table, ({ hit, volume }, key) => {
                let weight = _.round((volume * 100) / totalVolume);
                let score = hit * weight;
                table[key].weight = weight;
                table[key].score = score;
                if (score > topScore) {
                  topScore = score;
                }
              });
              let topRate = _.filter(
                table,
                ({ score }) => score > topScore / 4
              );
              console.log(topRate);
            })
            .catch((e) => {
              spinner.fail("Failed loading [.log]");
              logger.error("price", e.message);
            });
        });
    })
    .catch((e) => {
      spinner.fail("Failed loading [.log]");
      logger.error("Exchange", e.message);
    });
}

start();
