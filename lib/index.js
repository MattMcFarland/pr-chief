#!/usr/bin/env node

const assert = require('assert')
const { prompt } = require('inquirer')
const { resolve: resolvePath } = require('path')
const gitConfig = require('git-config')
const spawn = require('cross-spawn')
const GithubApi = require('./GithubApi')

const store = {}

getConfig()
  .then(addToStore('config'))
  .then(getCredentials)
  .then(configureApi)
  .then(addToStore('github'))
  .then(processPullRequests)
  .catch(console.error)

function processPullRequests (github) {
  getPullRequests(github)
  .then(exitIfNoPullRequests)
  .then(showPullRequestMenu)
  .then(exitOnCancel)
  .then(extractPullRequest)
  .then(clonePullRequest)
  .then(addToStore('prData'))
  .then(installDependencies)
  .then(runTests)
  .then(askForMerge)
  .then(mergeIfYes)
  .then(() => processPullRequests(github))
  .catch(console.error)
}

function getConfig () {
  const configPath = resolvePath(process.cwd(), '.git/config')
  return new Promise((resolve, reject) =>
    gitConfig(configPath, (err, config) => {
      if (err) {
        reject(err)
      } else {
        assert(config['remote "origin"'], 'remote origin must exist')
        assert(~config['remote "origin"'].url.indexOf('github'), 'remote origin for github not found')
        const repoUrl = config['remote "origin"'].url
        const repoParts = repoUrl.split('/').slice(3)
        const owner = repoParts[0]
        const repo = repoParts[1].split('.')[0]

        resolve({owner, repo})
      }
    }
  ))
}

function getCredentials () {
  const loginForm = [{
    name: 'user',
    type: 'input',
    message: 'Github Username:',
    default: store.config.owner
  },{
    name: 'pass',
    type: 'password',
    message: `Github Password:`
  }]
  return prompt(loginForm)
}

function configureApi ({user, pass}) {
  return GithubApi({
    auth: `${user}:${pass}`,
    headers: { 'User-Agent': 'Matt McFarland <contact@mattmcfarland.com>' }
  })
}

function getPullRequests (github) {
  const { owner, repo } = store.config
  return github.get(`/repos/${owner}/${repo}/pulls`)
}

function exitIfNoPullRequests (pullRequests) {
  if (pullRequests.length < 1) {
    console.log('No pull requests found. Exiting')
    process.exit(0)
  }
  return pullRequests
}

function showPullRequestMenu (pullRequests) {
  const choices = pullRequests.map((pr, index) => ({
    name: `(${pr.number}) ${pr.user.login}: "${pr.title}"`,
    short: pr.title,
    value: index
  }))
  choices.push({
    name: 'cancel',
    value: -1
  })
  return prompt([{
    name: 'requestSelection',
    type: 'list',
    message: 'Select a pull request',
    choices,
    filter: (val) => pullRequests[val] || val
  }])
}

function exitOnCancel (answers) {
  if (answers.requestSelection === -1) {
    console.log('cancelled.')
    process.exit(0)
  }
  return answers
}

function extractPullRequest (requestMenu) {
  return requestMenu.requestSelection
}

function clonePullRequest (pullRequest) {
  return new Promise((resolve, reject) => {
    const pathName = `pull-requests/${pullRequest.number}`
    const clonePath = resolvePath(process.cwd(), pathName)
    const branchName = pullRequest.head.ref
    console.log(`Cloning ${pullRequest.title} from ${pullRequest.head.ref} to ${clonePath}`)
    spawn('git', ['clone', pullRequest.head.repo.clone_url, '-b', branchName, clonePath], {stdio: 'inherit'})
      .on('close', code => !code ? resolve({pullRequest, clonePath, branchName}) : reject({message: 'An error occurred', code}))
  })
}

function installDependencies ({clonePath}) {
  return new Promise((resolve, reject) => {
    spawn('npm', ['install'], { cwd: clonePath, stdio: 'inherit' })
      .on('close', code => !code ? resolve(clonePath) : reject({message: 'An error occurred', code}))
  })
}

function runTests (clonePath) {
  return new Promise((resolve, reject) => {
    spawn('npm', ['test'], { cwd: clonePath, stdio: 'inherit' })
      .on('close', code => !code ? resolve(true) : reject({message: 'An error occurred', code}))
  })
}

function askForMerge () {
  return prompt([{
    type: 'confirm',
    name: 'performMerge',
    message: 'Would you like to merge now?',
    default: false
  }])
}

function mergeIfYes ({performMerge}) {
  if (!performMerge) {
    return false
  }
  const { owner, repo } = store.config
  const number = store.prData.pullRequest.number
  return store.github.put(`/repos/${owner}/${repo}/pulls/${number}/merge`)
}

function plog (promiseObject) {
  console.log(promiseObject)
  return promiseObject
}

function addToStore (keyName) {
  return value => {
    store[keyName] = value
    return value
  }
}
