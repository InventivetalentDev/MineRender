#!/bin/sh

setup_git() {
  git config --global user.email "mail@inventivetalent.org"
  git config --global user.name "inventivetalentDev"

  git remote add origin https://${GH_TOKEN}@github.com/InventivetalentDev/MineRender.git > /dev/null 2>&1
  git checkout -b master
}

commit_files() {
  git add dist/*
  git commit --message "Build #$TRAVIS_BUILD_NUMBER"

  git add docs/*
  git commit --message "Docs for Build #$TRAVIS_BUILD_NUMBER"
}

upload_files() {
  git push --quiet --set-upstream origin master
}

setup_git
commit_files
upload_files