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
                totalVolume += volume;
                let min = _.min([open, high, low, close]);
                if (minPrice === 0 || minPrice > min) {
                  minPrice = min;
                }
                let max = _.max([open, high, low, close]);
                if (maxPrice < max) {
                  maxPrice = max;
                }
              });
              console.log(totalVolume, minPrice, maxPrice);
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
