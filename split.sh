#!/bin/bash

# this file can be used when log_file.txt is too large but you don't need all the data in it

# Define input and output files
input_file="log_file.txt.orig"
output_file_yes="log_file.txt.yes"
output_file_no="log_file.txt.no"
split_height=860268

# Run the awk script
awk -F ';' -v split_height="$split_height" -v out_yes="$output_file_yes" -v out_no="$output_file_no" '
BEGIN {
    splitting = 0  # Initialize splitting flag
}
{
    # Check if we should start writing to "yes" output
    if ($3 == "block_start" && $2 >= split_height) {
        splitting = 1  # Start writing to "yes" output file
    }

    # Write to the appropriate file based on splitting flag
    if (splitting) {
        print > out_yes
    } else {
        print > out_no
    }
}' "$input_file"

echo "Split completed: data before "$split_height" is in '$output_file_no', starting from "$split_height" is in '$output_file_yes'."
