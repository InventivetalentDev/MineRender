#!/bin/sh

setup_git() {
  git config --global user.email "git-bot@inventivetalent.org"
  git config --global user.name "InventiveBot"
}

commit_files() {
  git checkout -b master

  git add dist/*
  git commit --message "Build #$TRAVIS_BUILD_NUMBER"

  git add docs/*
  git commit --message "Docs for Build #$TRAVIS_BUILD_NUMBER"
}

upload_files() {
  git remote add origin https://InventiveBot:${GH_TOKEN}@github.com/InventivetalentDev/MineRender.git > /dev/null 2>&1
  git push --quiet --set-upstream origin master
}

setup_git
commit_files
upload_files