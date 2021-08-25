const http = require('https');
const core = require('@actions/core');
const github = require('@actions/github');

// let month_to_fetch = core.getInput('year-month-to-fetch');
let time_to_fetch = null
if (!time_to_fetch) {
    time_to_fetch = new Date()
    time_to_fetch.setUTCDate(1);
}

// We use month ranges of 0 - 11
// as we want to query the previous month for GH
let month = time_to_fetch.getUTCMonth()

// But obviously a 0th month doesn't work
// thus we'll go ahead and set the month to 1 
if (month == 0) {
    month = 1
}


async function fetch_btc_transaction_info() {
    return new Promise((resolve, reject) => { 
        http.get({
            hostname: "blockstream.info",
            path: "/api/address/bc1qfhe7rq3lqzuayzjxzyt9waz9ytrs09kla3tsgr/txs/chain",
            method: "get",
            }, (res) => {
                res.setEncoding('utf8');
                var data = [];

                res.on('data', (chunk) => {
                    data.push(chunk)
                });

                res.on("end", () => {
                    resolve(JSON.parse(data.join("")))
                });
            });
    });
};


async function fetch_bounty_information() {
    const client = github.getOctokit(core.getInput('github-token'));

    // When bounties and their labels are eventually added to other repos 
    // code here should be uncommented
    // const repo_ids = (await client.request('GET /orgs/iv-org/repos')).data.map(i => i.id);
    // repo_ids.forEach(element => {
    //     let repo = await client.request('GET /orgs/iv-org/repos')
    // });

    const queryString = (
        "repo:iv-org/invidious " +
        "label:bounty:paid " + 
        `merged:${time_to_fetch.getUTCFullYear()}-${('0' + month).slice(-2)}-01..` + // Remove -1 later
        `${time_to_fetch.getUTCFullYear()}-${('0' + (month + 1)).slice(-2)}-01` // Add + 1 later
    );

    console.log(queryString)

    bounty_issue_numbers = (await client.request('GET /search/issues', {q: queryString})).data.items.map(i => i.number);
    bounty_comment_mapping = []
    for (let number of bounty_issue_numbers) {
        bounty_comment_found = false
        page = 0
        const regex_for_bounty_fiat_cost = /[Aa] \$?(?<bounty_cost>\d+)\$? bounty has been rewarded/mg
        const regex_for_bounty_crypto_cost = /Amount sent: (?<crypto_bounty_cost>\d+.?\d+ BTC)/mg

        while (!bounty_comment_found) {
            comments = await client.request('GET /repos/{owner}/{repo}/issues/{issue_number}/comments', {
                owner: 'iv-org',
                repo: 'invidious',
                issue_number: number,
                page: page,
                per_page: 100
            });

            // Reversing as the bounty comment is likely near the bottom
            potential_bounty_comments = (comments.data.filter((i) => i.user.login === "TheFrenchGhosty")).reverse();
            
            // Attempts to find the bounty comment
            for (let comment of potential_bounty_comments) {
                if (comment.body.includes("bounty has been rewarded")) {
                    bounty_comment_found = true
                    const bounty_cost_in_fiat = (regex_for_bounty_fiat_cost.exec(comment.body)).groups.bounty_cost;
                    const bounty_cost_in_crypto = (regex_for_bounty_crypto_cost.exec(comment.body)).groups.crypto_bounty_cost;

                    bounty_comment_mapping.push({
                        bounty_cost_fiat: bounty_cost_in_fiat,
                        bounty_cost_crypto: bounty_cost_in_crypto,
                        url: comment.html_url,
                        date: comment.created_at, 
                    });
                };
            };
            // If none can be found then we'll request the next page of comments
            page++
        };
    };

    return bounty_comment_mapping
};


(async() => {
   transactions = await fetch_btc_transaction_info()
   total_transactions_in_current_month = []
   for (let transaction of transactions) {
    occurrence = new Date(transaction.status.block_time * 1000)
    if (occurrence.getUTCFullYear() != time_to_fetch.getUTCFullYear()) {
        continue;
    }

    // We're using the 0-11 month attribute as a lazy way to refer to the previous month.
    // However, this fails when trying to compare two dates that both uses 0-11
    // Since they'll think that they both refer to the same month which is obviously not the case
    // August != July. 
    else if ((occurrence.getUTCMonth() + 1) != month) {
        continue;
    }

    transaction.vout.filter((i) => {
        if (i.scriptpubkey_address == "bc1qfhe7rq3lqzuayzjxzyt9waz9ytrs09kla3tsgr") {
            total_transactions_in_current_month.push(i.value / 100000000) 
        }
    });
   };

   core.setOutput("fetched-btc-bounty-data", JSON.stringify({
       new_btc_previous_month: total_transactions_in_current_month.reduce((a,b) => a + b, 0),
       bounty_costs: await fetch_bounty_information(),
   }));
})();

